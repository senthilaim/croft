#!/bin/sh
# Runs inside the sandboxed simulation container (see rebuild_simulation.py for the docker-run
# hardening flags this expects to be launched with, mirroring repo_analysis.py/entrypoint.sh).
# Builds a target once (baseline), makes a real content change to one file, builds it again with
# --explain, and reports what rebuilt and why. Both builds run in this single container/shell
# invocation deliberately -- Bazel's local action cache only persists within one output_base, so
# splitting this across two separate `docker run` calls would make every action look like a cold
# cache miss on the second build too, defeating the entire point.
set -eu

: "${REPO_URL:?REPO_URL is required}"
: "${REPO_TOKEN:?REPO_TOKEN is required}"
: "${BRANCH:?BRANCH is required}"
: "${TARGET:?TARGET is required}"
: "${FILE_PATH:?FILE_PATH is required}"

echo "Cloning $REPO_URL (branch $BRANCH)..." >&2
git -c http.extraheader="AUTHORIZATION: basic $(printf '%s' "x-access-token:$REPO_TOKEN" | base64 | tr -d '\n')" \
    clone --quiet --depth 1 --branch "$BRANCH" --single-branch "$REPO_URL" /workspace/repo >&2

# Same mitigation as entrypoint.sh, same reasoning: MODULE.bazel/WORKSPACE can run arbitrary
# Starlark, so the token must not still be live in the environment once Bazel starts.
unset REPO_TOKEN
REPO_TOKEN=""

cd /workspace/repo

if [ ! -f .bazelversion ]; then
  export USE_BAZEL_VERSION=7.4.1
fi

if [ ! -f "$FILE_PATH" ]; then
  echo "File not found in repo: $FILE_PATH" >&2
  exit 1
fi

echo "Running baseline build of $TARGET..." >&2
set +e
bazel --output_base=/tmp/bazel-output build "$TARGET" >/tmp/baseline-build.log 2>&1
BASELINE_EXIT=$?
set -e
cat /tmp/baseline-build.log >&2

if [ "$BASELINE_EXIT" -ne 0 ]; then
  echo "Baseline build failed (exit $BASELINE_EXIT) -- can't simulate a rebuild of a target that" >&2
  echo "doesn't build cleanly to begin with." >&2
  exit "$BASELINE_EXIT"
fi
BASELINE_TOTAL_ACTIONS="$(grep -oE '[0-9]+ total actions?' /tmp/baseline-build.log | grep -oE '^[0-9]+' | tail -1)"
BASELINE_TOTAL_ACTIONS="${BASELINE_TOTAL_ACTIONS:-0}"

# A real content-hash change, safe for any text file, language-agnostic. A bare `touch` only
# updates mtime, which Bazel does not treat as a content change (it compares digests for source
# files) -- so this must actually append a byte, not just bump a timestamp.
printf '\n' >> "$FILE_PATH"

echo "Running second build of $TARGET (after editing $FILE_PATH)..." >&2
set +e
bazel --output_base=/tmp/bazel-output build "$TARGET" --explain=/tmp/explain.log --verbose_explanations \
    >/tmp/second-build.log 2>&1
SECOND_EXIT=$?
set -e
cat /tmp/second-build.log >&2

if [ "$SECOND_EXIT" -ne 0 ]; then
  echo "Second build failed (exit $SECOND_EXIT)" >&2
  exit "$SECOND_EXIT"
fi
SECOND_TOTAL_ACTIONS="$(grep -oE '[0-9]+ total actions?' /tmp/second-build.log | grep -oE '^[0-9]+' | tail -1)"
SECOND_TOTAL_ACTIONS="${SECOND_TOTAL_ACTIONS:-0}"

echo "===ANALYSIS_JSON==="
# The baseline build count is the meaningful denominator here (the full size of the action graph,
# since nothing was cached yet) -- the second build's own "N total actions" only counts what it
# re-executed, which is the same number the explain log already gives per-action detail for.
python3 /usr/local/bin/explain_parser.py --baseline-total-actions "$BASELINE_TOTAL_ACTIONS" < /tmp/explain.log
