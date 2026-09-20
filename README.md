# Croft

Bazel Buildfarm as a Service — a self-hosted SaaS app, run entirely on your own machine, for
customers to sign up, create a multi-tenant workspace, visually design a Bazel Buildfarm topology,
provision it as real Docker containers, connect a sample Bazel project to it, and watch live build
+ infrastructure analytics fed by Bazel's Build Event Protocol (BEP).

**→ For step-by-step setup and run instructions, see [SETUP.md](SETUP.md).**

This README covers project layout and the design notes behind how it's built.

## Project layout

```
frontend/              Next.js app (signup/signin, workspace designer, sample project, dashboard)
backend/                NestJS API (auth, workspaces, buildfarm-config, provisioning proxy, MongoDB)
automation/             Python (FastAPI) service: Docker provisioning + BEP ingestion
packages/shared-types/  TypeScript types shared between frontend and backend
docker-compose.platform.yml   MongoDB for the platform itself
```

## Build analytics (BEP) — live

Plain `bazel build` streams live to the dashboard, no wrapper script. `automation/app/bes_server.py`
runs a real gRPC **Build Event Service** — the same `google.devtools.build.v1.PublishBuildEvent`
service Bazel's `--bes_backend` flag connects to — on port 9095. The sample project's `.bazelrc`
sets `--bes_backend=grpc://localhost:9095` and `--bes_header=x-workspace-id=<id>`, so Bazel
connects directly and streams each `build_event_stream.BuildEvent` (wrapped in a `google.protobuf.Any`)
over that connection as the build progresses.

The `.proto` files under `automation/protos/` are a **deliberately minimal, hand-trimmed subset**
of Bazel's and googleapis' real protos (same package/message/field names and numbers as upstream,
so they parse the real wire format) — see each file's header comment for what was kept and why.
This sidesteps vendoring Bazel's full error taxonomy and REST-gateway annotations while still
speaking the real BES protocol. Run `automation/generate_protos.sh` after editing them.

`bes_server.py` decodes each event and relays it as JSON to the backend's
`POST /api/workspaces/:id/builds/ingest-event`, which applies it incrementally to the workspace's
in-progress `Build` record: status flips to `running` on `started`, targets are added as
`targetCompleted` events arrive, and `finished` lands the final status/duration. Beyond pass/fail,
it also captures:

- **Failure reason** — an `Aborted` event's `description` when Bazel has one (e.g. a clean
  analysis-phase message), falling back to the tail of Bazel's own stderr `Progress` events
  (buffered per-workspace in `bes_server.py`) filtered to `ERROR` lines — this is what actually
  fires for most real action failures, since Bazel doesn't put a plain-text reason on every
  failure type.
- **Remote cache hits** — from the `BuildMetrics` event's `action_summary.runner_count`, summing
  entries named `"remote cache hit"`. This is the same signal behind the `"N remote cache hit"`
  line Bazel prints to its own console, and it's the correct one for "did the Buildfarm remote
  cache help" — the nearby `action_cache_statistics` field looks tempting but measures Bazel's
  *local*, on-disk action cache instead, which a same-session rebuild mostly skips checking via
  its in-memory Skyframe graph and so reports near-zero activity even when a real remote cache hit
  occurred. The now-deprecated `remote_cache_hits` field sitting right next to `runner_count` in
  the real proto is not populated by current Bazel at all — confirmed by dumping raw BEP JSON.

Every event also carries Bazel's own build UUID (`StreamId.invocation_id`, present on every BES
request), which `bes_server.py` threads through as `invocationId` and the backend uses to look up
the right `Build` document — not "whichever build most recently started in this workspace." This
is what makes two concurrent `bazel build` invocations in the same workspace resolve correctly
instead of corrupting each other's dashboard rows.

## Build event viewer

Clicking "View details" on any build (or navigating directly to
`/workspaces/<id>/builds/<buildId>` — a real, bookmarkable permalink, not client-only state) opens:

- **Failed actions** — Bazel emits an `ActionExecuted` BEP event by default whenever an action
  fails (capturing *every* action instead requires `--build_event_publish_all_actions`, which this
  app doesn't set — failures are where per-action detail matters most for debugging). Each one
  shows its mnemonic, exit code, command line, and — best-effort — its captured stdout/stderr,
  downloadable from the browser.
- **Timing waterfall** — a Gantt-style chart of every action Bazel ran, success or failure. This
  does *not* come from BEP action events (which, per above, only fire for failures) — it's parsed
  from Bazel's own JSON trace profile (Chrome Trace Event Format), the same data `chrome://tracing`
  or Perfetto would show you. Bazel generates one for every build regardless of outcome. Capped to
  the 300 longest spans per build to keep the chart readable.

**Both of the above are fetched via a real `google.bytestream.ByteStream.Read` client
(`automation/app/cas_client.py`), not local disk.** The obvious-looking assumption — "automation
runs on the same machine as the customer's own `bazel` CLI, so just read the path" — turns out to
be wrong in practice: once a remote cache is configured (every workspace here has one),
`--remote_build_event_upload`'s own docs confirm Bazel *always* uploads the trace profile and
per-action stdout/stderr to the remote cache and cites them as `bytestream://<host>/blobs/<hash>/<size>`
URIs, never `file://`, regardless of upload mode — confirmed by inspecting the real BEP wire
output. `cas_client.py` is a deliberately minimal, hand-trimmed subset of googleapis'
`google/bytestream/bytestream.proto` (`Read` only — this app is never a `Write`r), reading each
blob back from the same Buildfarm server Bazel just uploaded it to, with a short retry (the
generated `.bazelrc`'s `--bes_upload_mode=nowait_for_upload_complete` means the event announcing a
blob can arrive slightly before that blob finishes committing to the remote cache). Both paths
degrade to `null`/empty rather than erroring when a blob genuinely can't be read.

- **Build outputs** — the actual files a target produced (binaries, not just logs), also
  downloaded on demand through `cas_client.py`. Bazel doesn't list a target's outputs directly:
  `TargetComplete.output_group` references separately-emitted `NamedSetOfFiles` events (a small
  DAG, so a file shared by several targets is only sent once on the wire), which
  `bes_server.py` caches as they stream in and resolves once the target completes. Scoped to the
  **`default`** output group only (what plain `bazel build` gives you, not instrumentation/
  coverage groups) and excludes directory outputs (the real proto's own doc comment says these
  "will never include a uri," so ByteStream can't fetch them regardless). Unlike logs, artifact
  bytes are never eagerly fetched — the `Build` document only ever stores `{targetLabel, name,
  sizeBytes}`; the actual bytes are streamed fresh from Buildfarm's CAS only when you click
  Download, via a small dedicated `GET /artifacts?uri=...` route on the automation service and a
  `StreamableFile` response on the backend.

## Cache-only mode

Buildfarm's SHARD server has no CAS storage of its own — it delegates every blob write to a
registered Worker (`ServerInstance.getRandomWritingWorker()`), so a Worker is always provisioned,
even if you only want a shared remote cache rather than remote execution. The designer's Worker
node has an **"Enable remote execution"** toggle (`executionEnabled` in its config, wired through
to the rendered `config.yml`'s `capabilities.execution`): on, it's full RBE — Bazel offloads
actions to the Worker; off, the Worker still stores and serves CAS blobs (so `--remote_cache`
keeps working) but refuses execution dispatches, and Bazel runs actions locally. The canvas's
empty-state offers **"Full RBE"** and **"Cache only"** starter presets — both provision
Server + Worker + Redis, differing only in that one flag. The generated sample project's
`.bazelrc` reflects the choice: `--remote_executor` is present only when execution is enabled;
`--remote_cache` is always set.

The dashboard itself (`frontend/src/components/dashboard/live-dashboard.tsx`) is a client
component that polls both `.../builds` and `.../buildfarm/infra` every 2 seconds — stat tiles
(including aggregate cache hit rate), the duration chart, and the recent-builds table (with a
per-build cache hit/miss count and failure reason) all reflect an in-progress build within a
couple of seconds of it starting. The `ingest-event` endpoint is intentionally unauthenticated
(scoped only by workspace id in the URL) since it's only reachable from the same-machine
automation service; it'd need a per-workspace token before this app is ever exposed beyond
localhost.

## Infrastructure analytics

The same dashboard shows **live container-level CPU and memory usage** for every container in the
workspace's Buildfarm stack (server, worker(s), redis), via `docker stats --no-stream` scoped to
that workspace's container ids: `automation`'s `GET /infra/{workspace_id}` shells out to Docker,
`backend`'s `GET /workspaces/:id/buildfarm/infra` proxies it authenticated, and the dashboard polls
it alongside build data.

## Historical trends

`/workspaces/<id>/dashboard/trends` is a point-in-time range query, not a live poll like the main
dashboard — 24h/7d/30d range selector, re-fetches on change:

- **Build-time and remote cache hit rate, by day** — `BuildsService.getTrends` (this app's first
  MongoDB `.aggregate()` pipeline) buckets every `Build` document by calendar day (via
  `$dateToString` over `startTime`, which is why `build.schema.ts` now also indexes
  `{workspaceId, startTime}`, not just `{workspaceId, createdAt}`), averaging duration and summing
  cache hits/actions-executed per day. `Build` documents already live forever with no retention
  limit, so this needed a new query, not new data.
- **Executor utilization (CPU/mem) over time** — this one needed genuinely new infrastructure:
  `automation`'s live `GET /infra/{workspace_id}` is a synchronous `docker stats --no-stream` poll
  with zero history. `automation/app/infra_sampler.py` is a background thread (started alongside
  the BES server) that samples every running workspace's containers once a minute into a new
  `infra_samples` collection, self-pruned via a **Mongo TTL index** (7-day retention — no manual
  cleanup job). `GET /infra/{workspace_id}/trends` aggregates those samples into a fixed ~60 time
  buckets regardless of the requested range, so a 7-day query doesn't return raw minute-by-minute
  samples.

## Test analytics: flaky-test detection across runs

`/workspaces/<id>/dashboard/tests` is a **Test grid** — one row per test target, one cell per
recent `bazel test` invocation.

- Sourced from Bazel's real `TestSummary` BEP event (one per test target per invocation, Bazel's
  own aggregate over all that target's runs/shards/attempts) — the right grain for one grid cell,
  so per-attempt `TestResult` events aren't needed at all. Persisted to a new top-level `TestRun`
  Mongo collection (not embedded on `Build`, unlike `actions`/`waterfall`) because the grid pivots
  *across* many builds by label — a dedicated indexed collection avoids an expensive
  cross-document `$unwind` on every render.
- **Two different kinds of "flaky," both visible on the grid.** Bazel's own `TestSummary` already
  has a `FLAKY` status — set when a test failed then passed on a retry *within one invocation*
  (the sample project's `.bazelrc` sets `--flaky_test_attempts=3` so this can actually happen).
  That's a narrower signal than what "flaky-test detection" usually means for a dashboard like
  this: a test whose outcome varies *between separate invocations* over time. The grid computes
  that second signal itself (`isFlaky`, in `BuildsService.getTestGrid`) from each label's recent
  run history, and surfaces those rows first.
- **`bazel test` needed its own `.bazelrc` flags.** Bazel's `.bazelrc` sections are
  command-specific — the existing `build --remote_executor=...`/`--bes_*=...` lines silently
  didn't apply to `bazel test` at all. Fixed by adding matching `test --...` lines (see
  `sample-project.service.ts`'s `buildBazelrc()`); without this, no test event ever reached the
  dashboard, regardless of anything downstream.
- The generated sample project ships three demo test targets — `stable_test` (always passes),
  `always_fails_test` (always fails), `flaky_test` (~50/50 via `$RANDOM`, run it several times
  to see the grid flag it) — since the project had zero real test targets to verify this against
  otherwise. They need `rules_shell` (`sh_test` moved out of Bazel's native builtins in recent
  versions), the one `bazel_dep` in the generated `MODULE.bazel`.

## Connecting your own project (execution platforms)

The generated sample project is genrules and shell tests, which run anywhere. Real projects with
compiled toolchains (Go, Rust, C++, Node, ...) can hit a platform mismatch when they run on the
Buildfarm worker, so Croft helps with it generically for any repo.

**Symptom:** `Exec format error` on a remote action. **Cause:** Bazel resolves toolchains for the
*execution* platform, which defaults to the developer's own machine (say macOS/arm64). It then
ships that toolchain's binaries to the Linux worker, which cannot run them. Declaring a Linux
execution platform is necessary but not sufficient: the project's toolchains must also be
available for that OS and CPU (for example, a Linux SDK registered alongside the host one). That
part is a change to the project's own `MODULE.bazel`, so Croft cannot apply it for you.

**What Croft does:**
- Detects the worker's real OS/CPU (`docker image inspect`) and stores it on the instance.
- Sample-project page, "Use your own project": a copyable `.bazelrc` (remote cache/execution,
  BES streaming, test-scoped flags) and a `platforms/BUILD.bazel` matching the worker. The
  platform flags are generated commented-out, since enabling them is only correct once the
  project's toolchains support the worker's OS.
- Build page: an `Exec format error` failure gets a callout explaining the likely cause and
  linking back to that section.

## Auth architecture

The backend issues JWT access (15m) + refresh (7d) tokens. The frontend never exposes these to
client-side JS: Next.js Route Handlers under `frontend/src/app/api/**` act as a backend-for-frontend
— `api/auth/signup|signin` call the NestJS API and store the tokens as httpOnly cookies on the
frontend's own origin; a catch-all `api/[...path]` route forwards any other request to the backend
with the access token attached as a Bearer header. `proxy.ts` (Next's renamed middleware)
optimistically redirects unauthenticated requests to `/workspaces/*` back to `/signin`.

## Status

- [x] Monorepo scaffold, MongoDB connection, shared types
- [x] Signup/signin, multi-tenant workspaces
- [x] Drag-and-drop Buildfarm designer
- [x] Docker-based provisioning ("Submit Setup") — real `bazelbuild/buildfarm-server`/`-worker` containers
- [x] Sample Bazel project generator — verified with a real remote `bazel build`
- [x] BEP ingestion + build analytics dashboard — **live**, via a real BES gRPC server; tracks
      status, targets, duration, failure reasons, and remote cache hit rate, plus live infra
      (container CPU/mem) metrics
- [x] Cache-only provisioning mode — Worker stores/serves the remote cache without executing
- [x] Build event viewer — per-build permalink with failed-action detail, a real timing
      waterfall, and downloads for both logs and actual build output artifacts
- [x] Historical trends — build-time/cache-hit-rate by day, executor CPU/mem utilization over
      time (new background sampler + TTL-pruned collection)
- [x] Test analytics — a Test grid with flaky-test detection across separate `bazel test` runs,
      not just Bazel's own single-invocation retry detection

## Known simplifications (fine for local-first v1, flagged for a hardening pass)

- **The builds ingest endpoint is unauthenticated** — see "Build analytics" above.
- **No auto-refresh of the access token** — it expires after 15 minutes; the user just signs in
  again. A refresh flow exists at the API level (`POST /auth/refresh`) but isn't wired into the
  frontend yet.
- **Live updates are polling, not push** — the dashboard polls every 2s rather than a WebSocket/SSE
  push; noticeably "live" for any real build, just not sub-second.
- **Per-target build duration isn't tracked** — Bazel's `TargetComplete` event doesn't carry a
  duration field; the dashboard's duration chart uses overall build time instead.
- **Executor utilization history only covers the last 7 days** — the `infra_samples` TTL index
  prunes anything older; the trends page's "30d" range option reuses the same 7-day-capped
  utilization data as "7d" for that reason, while build-time/cache-hit trends (backed by `Build`
  documents, which have no retention limit) genuinely cover the full 30 days requested.
- **A single in-flight rebuild in the same Bazel server session can under-report remote cache
  hits** — Skyframe may short-circuit actions it already knows the result of without asking the
  remote cache at all. `bazel clean` (or `bazel shutdown`) before rebuilding forces a real check.
  See "Build analytics" above for the metric this app actually reads and why.
- **Only failed actions get per-action detail** — capturing every action (success and failure)
  needs `--build_event_publish_all_actions`, which this app deliberately doesn't set, to keep event
  volume down on large builds. The timing waterfall isn't affected by this — it's sourced
  separately from Bazel's trace profile, not BEP action events.
- **The timing waterfall is capped at 300 spans** — the longest-running ones, sorted by duration.
  A build with more actions than that will have its fastest ones omitted from the chart.
- **Build output artifacts are only tracked for the `default` output group, capped at 300 per
  build, and only downloadable while still present in Buildfarm's CAS** — a local-only action
  cache hit (skips remote entirely) means the referenced blob may never have been uploaded to the
  remote cache at all; the download endpoint 404s cleanly in that case rather than erroring.
- **The test grid's per-target history is capped at the last 20 runs** — `TestRun` documents
  themselves aren't pruned (unlike `infra_samples`), only the grid's query window is capped, to
  keep each row's render small.
