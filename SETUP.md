# Setup & Run Guide

Step-by-step instructions to get Croft (Bazel Buildfarm as a Service) running on your machine,
end to end: sign up, design a Buildfarm, provision it, and run real remote builds that stream live to
the dashboard as they happen — status, targets, duration, failure reasons, remote cache hit rate,
and container CPU/memory. For architecture/design notes, see [README.md](README.md).

> **Just want to run Croft?** Use `./install.sh` (Docker only) -- see the Quickstart in
> [README.md](README.md). Everything below is the from-source development setup.

## 0. Prerequisites

Install these before starting:

| Tool | Version | Check |
|---|---|---|
| Node.js | 20+ | `node -v` |
| npm | 10+ | `npm -v` |
| Docker Desktop (or another local Docker daemon) | any recent | `docker info` |
| Python | 3.11+ | `python3 -V` |
| Bazel or Bazelisk | any recent | `bazel --version` |

Docker must actually be **running** (not just installed) for every step below that touches
containers.

> If you already run MongoDB natively on this machine (e.g. a Homebrew service on port 27017),
> that's fine — this project's own MongoDB runs in Docker on port **27018** specifically to avoid
> colliding with it. No action needed on your part.

## 1. First-time setup

Run once, from the repo root:

```bash
# 1a. Install all JS dependencies (npm workspaces: frontend, backend, packages/shared-types)
npm install

# 1b. Copy environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp automation/.env.example automation/.env

# 1c. Set up the Python automation service
cd automation
python3 -m venv venv
. venv/bin/activate
pip install -r requirements.txt

# 1d. Compile the Build Event Service (BES) proto stubs -- this is what lets a plain
# "bazel build" stream live to the dashboard (see README.md's "Build analytics" section)
./generate_protos.sh
cd ..
```

The default `.env` values all point at each other correctly for local use (ports 3000 / 4000 /
9000 / 9095 / 27018) — no editing required to get started.

> Re-run `automation/generate_protos.sh` any time you edit the `.proto` files under
> `automation/protos/` — `automation/app/generated/` is build output, not checked into git.

## 2. Start the platform database

```bash
docker compose -f docker-compose.platform.yml up -d
```

Verify it's healthy:

```bash
docker compose -f docker-compose.platform.yml ps
# croft-mongo should show "Up ... (healthy)"
```

Leave this running — it only needs to be started once per machine session (`docker compose ... down`
to stop it later, if you want).

## 3. Start the three app services

Open three terminals (or run each in the background) from the repo root:

```bash
# Terminal 1 — backend API (NestJS), http://localhost:4000, routes under /api
npm run dev:backend

# Terminal 2 — automation service (FastAPI), http://localhost:9000, internal only
npm run dev:automation

# Terminal 3 — frontend (Next.js), http://localhost:3000
npm run dev:frontend
```

Confirm each is up:

```bash
curl http://localhost:4000/api/health   # {"status":"ok","mongo":"connected"}
curl http://localhost:9000/health       # {"status":"ok","besPort":9095}
curl -I http://localhost:3000           # HTTP/1.1 200 OK
```

The automation service also starts a gRPC **Build Event Service (BES)** server on port 9095 at
the same time (that's the `besPort` in its health check) — this is what lets `bazel build` stream
live to the dashboard with no wrapper script. Confirm it's listening:

```bash
lsof -nP -iTCP:9095 -sTCP:LISTEN   # should show the automation service's Python process
```

> `npm run dev` at the root starts Mongo + backend + frontend together, but **not** automation —
> start that one separately (Terminal 2 above) since provisioning ("Submit Setup") and live build
> streaming both depend on it.

## 4. Use the app

1. **Sign up** — open http://localhost:3000/signup, create an account.
2. **Create a workspace** — you land on `/workspaces`; give it a name and create it.
3. **Design a Buildfarm** — click into the workspace → **Open Buildfarm designer**. On an empty
   canvas, click **Full RBE** to lay out Server + Worker + Redis wired for remote execution in one
   click, or **Cache only** for the same three nodes but with the Worker's execution disabled (it
   still stores/serves the remote cache — see README.md's "Cache-only mode" section for why a
   Worker is required either way). Or build it by hand: drag one **Server**, one **Worker**, and
   one **Redis Backplane** node onto the canvas, connect Server → Worker and Server → Redis
   Backplane; click the Worker node to toggle **Enable remote execution** off if you want
   cache-only. Click **Save configuration**.
4. **Provision it** — click **Submit Setup**. This runs real Docker containers
   (`bazelbuild/buildfarm-server`, `bazelbuild/buildfarm-worker`, `redis`) for this workspace. The
   first time, Docker has to pull those images — allow a minute or two; subsequent workspaces are
   fast since the images are cached. Status flips to **running** when it's ready, showing the
   Buildfarm's `grpc://localhost:<port>` endpoint.
5. **Get the sample project** — click **Get sample project** (or navigate to
   `/workspaces/<id>/sample-project`) → **Download sample project**. Unzip it:

   ```bash
   unzip buildfarm-sample-project.zip -d sample-project
   cd sample-project
   ```

6. **Open the dashboard, then build** — open the workspace's **Build analytics** page
   (`/workspaces/<id>/dashboard`) in your browser, then run:

   ```bash
   bazel build //:hello              # runs remotely on your provisioned worker
   cat bazel-bin/hello.txt
   ```

   No extra flags or wrapper script needed — the downloaded `.bazelrc` already points Bazel's
   `--bes_backend` at the automation service, so this plain `bazel build` streams live: watch the
   dashboard flip to `running`, the Server/Worker/Redis CPU/memory bars move, and the final
   status/duration land within a couple of seconds of the build finishing.

7. **See every metric the dashboard tracks** — the sample project also ships a bigger example
   (multiple targets with real dependencies, a slow target, and two different kinds of failure).
   Its README walks through it, but the short version:

   ```bash
   bazel build //:good_targets              # 10 targets, real dependency graph
   bazel clean && bazel build //:good_targets   # re-verifies the cache -> real remote cache hits
   bazel build //:broken_action             # fails executing -> reason from Bazel's own output
   bazel build //:broken_dependency         # fails on a missing input -> a different reason
   ```

   Each shows up as its own row on the dashboard with status, target count, remote cache hits,
   duration, and (for the two failures) the actual error text in the **Reason** column. If your
   Worker is in cache-only mode, these targets still build (locally, on your own machine) and the
   second run still shows cache hits — just served from the Worker's cache instead of executed on
   it.

8. **Drill into one build** — click **View details** on any row (or `bazel build //:broken_action`
   and click through) to open its permalink at `/workspaces/<id>/builds/<buildId>`. You'll see the
   failing action's mnemonic, exit code, and command line, with its stdout/stderr downloadable from
   the browser, plus a timing waterfall of every action Bazel ran during that build (not just the
   failed ones) — parsed straight from Bazel's own JSON trace profile.

## 5. Stop everything

```bash
# Stop the three dev servers: Ctrl+C in each terminal, or:
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill   # frontend
lsof -ti:4000 -sTCP:LISTEN | xargs -r kill   # backend
lsof -ti:9000 -sTCP:LISTEN | xargs -r kill   # automation

# Tear down a workspace's Buildfarm containers (or click "Teardown" in the designer):
curl -X POST http://localhost:4000/api/workspaces/<workspaceId>/buildfarm/teardown \
  -H "Authorization: Bearer <accessToken>"

# Stop the platform database (optional — safe to leave running between sessions):
docker compose -f docker-compose.platform.yml down
```

Each workspace you provision and never tear down leaves its containers running. To see what's
still up across all workspaces (e.g. after experimenting with several):

```bash
docker ps -a --filter "name=workspace-" --format '{{.Names}} {{.Status}}'
```

If you'd rather tear one down without hunting for its access token, call the automation service
directly (it's internal-only, so this only works from the same machine):

```bash
curl -X POST http://localhost:9000/teardown \
  -H "Content-Type: application/json" -H "X-Internal-Token: <AUTOMATION_INTERNAL_TOKEN from automation/.env>" \
  -d '{"workspaceId":"<workspaceId>"}'
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: Cannot connect to the Docker daemon` | Start Docker Desktop, wait for it to fully boot, retry. |
| Mongo health check fails / backend says `"mongo":"disconnected"` | Confirm `docker compose -f docker-compose.platform.yml ps` shows Mongo `healthy`; confirm `backend/.env`'s `MONGODB_URI` uses port **27018**. |
| `Submit Setup` hangs or fails on first try | First provision per machine pulls ~300MB+ of Docker images; give it 1–2 minutes. Check `docker ps` / `docker logs workspace-<id>-server-1` for details if it errors. |
| `pip install -r requirements.txt` fails building `pydantic-core` | Your Python version is newer than the pinned wheels support. `requirements.txt` uses unpinned `>=` versions for this reason — if you edited it to pin exact versions, revert to the `>=` ranges. |
| Port 27017 already in use when starting Mongo | Expected if you run a native MongoDB — this project uses 27018 instead; no action needed unless you changed the compose file. |
| `bazel build` doesn't seem to hit the remote worker | Confirm `.bazelrc` in the sample project has `--remote_executor=grpc://localhost:<port>` matching the workspace's current port (shown on the designer/status page — ports are assigned per workspace and persist across restarts). |
| Automation service fails to start with an `ImportError` for `google.devtools.build.v1` or `build_event_stream` | Proto stubs haven't been generated. Run `cd automation && . venv/bin/activate && ./generate_protos.sh`. |
| Build never shows up on the dashboard | Confirm the sample project's `.bazelrc` has `--bes_backend=grpc://localhost:9095` and `--bes_header=x-workspace-id=<this workspace's id>` (re-download the sample project if it's stale — ports/ids are baked in at download time). Confirm the automation service is running and port 9095 is listening (see step 3). |
| `Address already in use` on port 9095 when starting automation | Another automation instance (or a stale process) is already bound to the BES port. `lsof -ti:9095 -sTCP:LISTEN \| xargs -r kill`, then restart `npm run dev:automation`. |
| Builds land against the wrong (or a torn-down) workspace | The `.bazelrc` you're building with has a stale port/`x-workspace-id` baked in from an earlier download — e.g. your browser saved a repeat download as `buildfarm-sample-project-1.zip`/`-2.zip` and you unzipped the old one. Re-download from the workspace's **Get sample project** page and use that extracted copy. |
