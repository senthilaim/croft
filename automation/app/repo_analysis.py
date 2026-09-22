"""Launches the sandboxed analysis-runner container (see automation/analysis-runner/) for a
connected repo, parses its result, and tears down the per-job network it created. Follows the same
subprocess conventions as docker_manager.py's _run_compose: subprocess.run(..., capture_output=True,
text=True, timeout=N), no shell=True.

This is the one place in the app that runs a third party's code (Bazel's MODULE.bazel/WORKSPACE
resolution executes arbitrary Starlark to fetch/patch external deps). The hardening flags below
are Docker-level (no socket, no lateral movement, resource caps, non-root, no privilege escalation,
read-only rootfs) -- they reduce blast radius, they are not a full security sandbox against a
kernel/container escape.
"""

import json
import logging
import re
import subprocess
from pathlib import Path

log = logging.getLogger("repo_analysis")

IMAGE = "croft-analysis-runner"
# Baked into the automation image at build time (COPY . . in automation/Dockerfile, context
# ./automation, so automation/analysis-runner/ on disk lands here). Built lazily on first use below,
# not at automation startup, so a fresh install doesn't pay this cost until someone actually uses
# the Analyze feature.
ANALYSIS_RUNNER_DIR = Path(__file__).resolve().parent.parent / "analysis-runner"
DELIMITER = "===ANALYSIS_JSON==="
DEFAULT_TIMEOUT_SECONDS = 600  # wall-clock cap on the whole job: clone + all bazel invocations.
TMPFS_SIZE = "2g"


class AnalysisError(Exception):
    def __init__(self, message: str, log_tail: str = ""):
        super().__init__(message)
        self.log_tail = log_tail


def _container_name(workspace_id: str) -> str:
    return f"analysis-{workspace_id}"


def _network_name(workspace_id: str) -> str:
    return f"analysis-net-{workspace_id}"


def _validate_workspace_id(workspace_id: str) -> None:
    # Same guard main.py already applies to workspace ids reaching the filesystem/container names.
    if not re.fullmatch(r"[0-9a-f]{24}", workspace_id):
        raise ValueError("Invalid workspace id")


def _tmpfs(mount: str, size: str = TMPFS_SIZE) -> list[str]:
    return ["--tmpfs", f"{mount}:size={size},uid=10001,gid=10001,exec"]


def _image_exists() -> bool:
    result = subprocess.run(["docker", "image", "inspect", IMAGE], capture_output=True, timeout=15)
    return result.returncode == 0


def _host_arch() -> str:
    """The host daemon's architecture ("arm64"/"amd64"), used as an explicit --build-arg below.
    BuildKit normally auto-populates TARGETARCH from the build's target platform, but that
    inference isn't reliable for a context streamed over stdin (observed: it resolved empty,
    404-ing the arch-specific Bazelisk download) -- so this is asked for explicitly instead."""
    result = subprocess.run(
        ["docker", "version", "--format", "{{.Server.Arch}}"], capture_output=True, text=True, timeout=15
    )
    arch = result.stdout.strip()
    return arch if arch in ("amd64", "arm64") else "amd64"


def _build_image() -> None:
    """Builds the sandbox image from the copy baked into this container. Streamed as a tar over
    stdin rather than a path, because automation talks to the *host's* Docker daemon through the
    mounted socket -- a path that only exists inside this container (like ANALYSIS_RUNNER_DIR) is
    not visible to that daemon, the same bind-mount-path problem the platform's own config
    rendering already works around."""
    log.info("building %s image (first use, this can take a minute)...", IMAGE)
    tar_proc = subprocess.Popen(
        ["tar", "-cf", "-", "-C", str(ANALYSIS_RUNNER_DIR), "."], stdout=subprocess.PIPE
    )
    try:
        build = subprocess.run(
            ["docker", "build", "-t", IMAGE, "--build-arg", f"TARGETARCH={_host_arch()}", "-"],
            stdin=tar_proc.stdout,
            capture_output=True,
            text=True,
            timeout=300,
        )
    finally:
        if tar_proc.stdout:
            tar_proc.stdout.close()
        tar_proc.wait()
    if build.returncode != 0:
        raise AnalysisError(
            f"Failed to build the analysis sandbox image (exit {build.returncode})",
            log_tail=build.stderr[-4000:],
        )


def _cleanup(workspace_id: str) -> None:
    subprocess.run(["docker", "rm", "-f", _container_name(workspace_id)], capture_output=True, timeout=30)
    subprocess.run(["docker", "network", "rm", _network_name(workspace_id)], capture_output=True, timeout=30)


def run_analysis(
    workspace_id: str,
    repo_url: str,
    token: str,
    branch: str,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict:
    """Clones and analyzes `repo_url` inside a fresh, hardened, network-isolated container.
    Returns the parsed analysis dict on success. Raises AnalysisError on any failure (bad repo,
    query failure, timeout) -- callers persist that as the analysis's `errorMessage`."""
    _validate_workspace_id(workspace_id)
    if not _image_exists():
        _build_image()
    container_name = _container_name(workspace_id)
    network_name = _network_name(workspace_id)

    # Always start clean: a previous run's container/network may still exist if a prior job
    # crashed or timed out before its own cleanup ran.
    _cleanup(workspace_id)

    subprocess.run(["docker", "network", "create", network_name], capture_output=True, text=True, timeout=30)

    cmd = [
        "docker",
        "run",
        "--rm",
        "--name",
        container_name,
        "--network",
        network_name,
        "--cap-drop=ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        "10001:10001",
        "--read-only",
        *_tmpfs("/tmp"),
        *_tmpfs("/home/analyzer/.cache"),
        *_tmpfs("/workspace"),
        "--cpus",
        "2",
        "--memory",
        "4g",
        "--pids-limit",
        "512",
        "-e",
        f"REPO_URL={repo_url}",
        "-e",
        f"REPO_TOKEN={token}",
        "-e",
        f"BRANCH={branch}",
        IMAGE,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        log.warning("analysis job for workspace %s exceeded %ss, killing it", workspace_id, timeout_seconds)
        _cleanup(workspace_id)
        raise AnalysisError("Analysis exceeded the time limit") from None
    finally:
        subprocess.run(["docker", "network", "rm", network_name], capture_output=True, timeout=30)

    if result.returncode != 0:
        raise AnalysisError(
            f"Analysis failed (exit {result.returncode})",
            log_tail=result.stderr[-4000:],
        )

    if DELIMITER not in result.stdout:
        raise AnalysisError("Analysis produced no result", log_tail=result.stdout[-4000:] + result.stderr[-2000:])

    payload = result.stdout.split(DELIMITER, 1)[1].strip()
    try:
        return json.loads(payload)
    except json.JSONDecodeError as err:
        raise AnalysisError(f"Could not parse analysis output: {err}", log_tail=payload[-2000:]) from err
