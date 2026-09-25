# Sandboxed image for analyzing a connected repo. Runs as a short-lived, non-root, hardened
# container launched by automation/app/repo_analysis.py -- see that file and the plan for the
# full set of docker-run hardening flags this image relies on being applied at launch time
# (--cap-drop=ALL, --read-only, --network <per-job>, resource limits, --rm).
#
# This container executes a third party's Bazel build files (MODULE.bazel/WORKSPACE can run
# arbitrary Starlark). Docker-level hardening reduces blast radius; it is not a full security
# sandbox against a kernel/container escape.
FROM ubuntu:24.04

# Set automatically by BuildKit to the image's own target architecture (amd64/arm64) -- used below
# to fetch the matching Bazelisk binary rather than hardcoding one, which would otherwise silently
# run under emulation (Rosetta/qemu) and can fail inside a hardened, read-only container.
ARG TARGETARCH

# build-essential/nodejs/golang-go: many repos' repository rules shell out to a compiler or
# another language runtime *during* dependency fetch, before a single Bazel action runs -- without
# these, that fails with a plain "command not found" that has nothing to do with the repo itself.
# This is a one-time cost (the image is built lazily on first use and cached, not rebuilt per
# analysis) traded for meaningfully broader compatibility with real-world repos.
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends \
       git curl ca-certificates python3 build-essential nodejs npm golang-go \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /usr/local/bin/bazel \
       "https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-${TARGETARCH}" \
    && chmod +x /usr/local/bin/bazel

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin analyzer
USER analyzer
WORKDIR /workspace
ENV HOME=/home/analyzer USE_BAZEL_VERSION="" BAZELISK_HOME=/home/analyzer/.cache/bazelisk

COPY --chown=analyzer:analyzer entrypoint.sh /usr/local/bin/analysis-entrypoint.sh
COPY --chown=analyzer:analyzer parse_query.py /usr/local/bin/parse_query.py
COPY --chown=analyzer:analyzer simulate-entrypoint.sh /usr/local/bin/simulate-entrypoint.sh
COPY --chown=analyzer:analyzer explain_parser.py /usr/local/bin/explain_parser.py

# Default entrypoint is the repo-analysis job; rebuild_simulation.py launches this same image
# with `docker run --entrypoint /usr/local/bin/simulate-entrypoint.sh` instead.
ENTRYPOINT ["/usr/local/bin/analysis-entrypoint.sh"]
