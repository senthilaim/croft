# Bazel Buildfarm as a Service

A self-hosted SaaS app — run entirely on your own machine — for customers to sign up, create a
multi-tenant workspace, visually design a Bazel Buildfarm topology, provision it as real Docker
containers, connect a sample Bazel project to it, and watch live build + infrastructure analytics
fed by Bazel's Build Event Protocol (BEP).

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

## Known simplifications (fine for local-first v1, flagged for a hardening pass)

- **The builds ingest endpoint is unauthenticated** — see "Build analytics" above.
- **No auto-refresh of the access token** — it expires after 15 minutes; the user just signs in
  again. A refresh flow exists at the API level (`POST /auth/refresh`) but isn't wired into the
  frontend yet.
- **Live updates are polling, not push** — the dashboard polls every 2s rather than a WebSocket/SSE
  push; noticeably "live" for any real build, just not sub-second.
- **Per-target build duration isn't tracked** — Bazel's `TargetComplete` event doesn't carry a
  duration field; the dashboard's duration chart uses overall build time instead.
- **A single in-flight rebuild in the same Bazel server session can under-report remote cache
  hits** — Skyframe may short-circuit actions it already knows the result of without asking the
  remote cache at all. `bazel clean` (or `bazel shutdown`) before rebuilding forces a real check.
  See "Build analytics" above for the metric this app actually reads and why.
- **One in-progress build per workspace at a time** — events without an invocation id (everything
  but `started`) are attributed to "whichever build most recently started in this workspace,"
  since BES events don't repeat it. Fine for a single local user; would need per-stream state
  keyed by Bazel's own `StreamId` to support concurrent builds in one workspace.
