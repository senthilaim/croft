#!/bin/sh
# Runs inside the sandboxed analysis container (see repo_analysis.py for the docker-run hardening
# flags this expects to be launched with, and the plan for why). Baked into the image rather than
# passed as an argument, so it can't be tampered with by anything supplied at run time.
set -eu

: "${REPO_URL:?REPO_URL is required}"
: "${REPO_TOKEN:?REPO_TOKEN is required}"
: "${BRANCH:?BRANCH is required}"

echo "Cloning $REPO_URL (branch $BRANCH)..." >&2
git -c http.extraheader="AUTHORIZATION: basic $(printf '%s' "x-access-token:$REPO_TOKEN" | base64 | tr -d '\n')" \
    clone --quiet --depth 1 --branch "$BRANCH" --single-branch "$REPO_URL" /workspace/repo >&2

# The token must not still be live in the environment once Bazel starts executing the repo's own
# Starlark (MODULE.bazel/WORKSPACE can fetch/patch external deps, i.e. run arbitrary code from a
# repo we don't trust). Clearing it here, before any bazel invocation, is the concrete mitigation.
unset REPO_TOKEN
REPO_TOKEN=""

cd /workspace/repo
COMMIT_SHA="$(git rev-parse HEAD)"

# Bazelisk already respects a repo's own .bazelversion (it takes precedence over this env var,
# checked only as a fallback). Without one, Bazelisk defaults to whatever Bazel most recently
# released -- a moving target that keeps getting *less* compatible with older repos as Bazel drops
# WORKSPACE-era machinery (observed: a repo with a plain WORKSPACE http_archive() and no
# MODULE.bazel found zero targets under Bazel 9, "--noenable_bzlmod" did not help, and the same
# repo analyzed cleanly under 7.4.1). Pinning a known-good fallback -- new enough for full bzlmod
# support, old enough to still fully support WORKSPACE -- makes analysis results reproducible
# instead of silently drifting with every new Bazel release.
if [ ! -f .bazelversion ]; then
  export USE_BAZEL_VERSION=7.4.1
fi

echo "Running bazel query..." >&2
set +e
# Bazel's own progress (package loading, "N actions running", and any real errors) goes straight
# to this script's stderr -- i.e. the container's own stderr -- so it shows up live in `docker
# logs` while the job is still running, not just captured to a file and revealed after the fact.
bazel --output_base=/tmp/bazel-output query --output=streamed_jsonproto --keep_going 'kind(rule, //...)' \
    >/tmp/query-result.json
QUERY_EXIT=$?
set -e

# Exit code 3 means some packages failed to load but others succeeded -- still usable, partial
# results. Any other non-zero exit (bad flags, no BUILD files at all, etc.) is a real failure --
# the actual reason already streamed to stderr above.
if [ "$QUERY_EXIT" -ne 0 ] && [ "$QUERY_EXIT" -ne 3 ]; then
  echo "bazel query failed (exit $QUERY_EXIT)" >&2
  exit "$QUERY_EXIT"
fi

echo "===ANALYSIS_JSON==="
python3 /usr/local/bin/parse_query.py --commit-sha "$COMMIT_SHA" --partial "$([ "$QUERY_EXIT" -eq 3 ] && echo true || echo false)" < /tmp/query-result.json
