#!/bin/sh
# Runs inside the sandboxed cache-check container (see automation/app/cache_check.py for the
# docker-run hardening flags this expects, mirroring repo_analysis.py/rebuild_simulation.py) --
# with one deliberate difference from those: this container gets --add-host=host.docker.internal
# so it can reach the workspace's own real, running Buildfarm over the network. That's an
# intentional, narrow break of the sandbox's usual network isolation (see cache_check.py's own
# note) -- --remote_cache only, --remote_executor is never set here.
#
# Two builds, each with its OWN fresh --output_base, deliberately not sharing one like
# simulate-entrypoint.sh's two builds do -- with no local disk cache to speak of in either build,
# any reported cache hit is unambiguously served by the real remote cache, not local disk. Real
# repos with more than one target-affecting invocation won't get a false "hit" from a warm local
# cache muddying the read/round-trip signal.
set -eu

: "${REPO_URL:?REPO_URL is required}"
: "${REPO_TOKEN:?REPO_TOKEN is required}"
: "${BRANCH:?BRANCH is required}"
: "${TARGET:?TARGET is required}"
: "${REMOTE_CACHE_GRPC:?REMOTE_CACHE_GRPC is required}"
: "${REMOTE_INSTANCE_NAME:?REMOTE_INSTANCE_NAME is required}"

echo "Cloning $REPO_URL (branch $BRANCH)..." >&2
git -c http.extraheader="AUTHORIZATION: basic $(printf '%s' "x-access-token:$REPO_TOKEN" | base64 | tr -d '\n')" \
    clone --quiet --depth 1 --branch "$BRANCH" --single-branch "$REPO_URL" /workspace/repo >&2

# Same mitigation as the other two entrypoints, same reasoning: MODULE.bazel/WORKSPACE can run
# arbitrary Starlark, so the token must not still be live once Bazel starts. This build also has
# real network reachability to the workspace's own Buildfarm -- clearing the GitHub token doesn't
# change that exposure, it only keeps the token itself from being usable by that untrusted code.
unset REPO_TOKEN
REPO_TOKEN=""

cd /workspace/repo

if [ ! -f .bazelversion ]; then
  export USE_BAZEL_VERSION=7.4.1
fi

# --remote_executor is deliberately never set -- this job answers "is my cache working," not "can
# I dispatch real execution to my worker pool," and the latter is a materially bigger abuse surface
# for a sandbox that's about to run a third party's untrusted build files. --remote_upload_local_results
# is Bazel's own default (true); set explicitly here so that default is documented, not implicit.
REMOTE_FLAGS="--remote_cache=$REMOTE_CACHE_GRPC --remote_instance_name=$REMOTE_INSTANCE_NAME --remote_timeout=60s --remote_retries=3 --remote_upload_local_results=true"

echo "Running read check (fresh cache, checking what's already there)..." >&2
set +e
# shellcheck disable=SC2086
bazel --output_base=/tmp/bazel-output-read build "$TARGET" $REMOTE_FLAGS \
    --execution_log_json_file=/tmp/exec-read.json >/tmp/read-check.log 2>&1
READ_EXIT=$?
set -e
cat /tmp/read-check.log >&2

if [ "$READ_EXIT" -ne 0 ]; then
  echo "Read check build failed (exit $READ_EXIT)" >&2
  exit "$READ_EXIT"
fi

echo "Running round-trip check (fresh cache again, same target)..." >&2
set +e
# shellcheck disable=SC2086
bazel --output_base=/tmp/bazel-output-roundtrip build "$TARGET" $REMOTE_FLAGS \
    --execution_log_json_file=/tmp/exec-roundtrip.json >/tmp/roundtrip-check.log 2>&1
ROUNDTRIP_EXIT=$?
set -e
cat /tmp/roundtrip-check.log >&2

if [ "$ROUNDTRIP_EXIT" -ne 0 ]; then
  echo "Round-trip check build failed (exit $ROUNDTRIP_EXIT)" >&2
  exit "$ROUNDTRIP_EXIT"
fi

echo "===ANALYSIS_JSON==="
python3 /usr/local/bin/cache_execution_log_parser.py \
    --read-log /tmp/exec-read.json \
    --roundtrip-log /tmp/exec-roundtrip.json
