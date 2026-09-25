"""Launches the sandboxed cache-check container (see automation/analysis-runner/) to answer "does
my remote cache actually work": builds a target twice, each against its own fresh output_base, both
pointed at the workspace's own real, running Buildfarm's remote cache, and reports the real hit rate.

Reuses the same croft-analysis-runner image as repo_analysis.py/rebuild_simulation.py, via
--entrypoint cache-check-entrypoint.sh. Deliberately duplicates their subprocess/hardening/retry
conventions rather than sharing a helper -- see rebuild_simulation.py's own note on this; this is
the third near-identical job runner and factoring one out is still not worth it, since this job's
docker-run flags diverge in a security-relevant way (see below).

SECURITY NOTE: this is the one sandboxed job in this app that intentionally gives the
untrusted-code-executing container real network reachability to the workspace's own, running
Buildfarm (via --add-host=host.docker.internal:host-gateway, so it can reach the Buildfarm's
host-published gRPC port). Every other sandbox job in this app is fully network-isolated from
Croft's own infrastructure by design; this one is not, on purpose, because answering "does my cache
work" requires actually talking to it. The bazelrc this job's entrypoint builds only ever sets
--remote_cache, never --remote_executor -- validating cache reuse doesn't require dispatching the
untrusted repo's actions onto the user's real worker pool, and doing so would be a materially
bigger abuse surface for no benefit to what this feature answers. Callers must only invoke this for
a workspace whose Buildfarm is confirmed 'running' (checked backend-side before this is called).
"""

import json
import logging
import re
import subprocess
import time
from pathlib import Path

from .settings import settings

log = logging.getLogger("cache_check")

IMAGE = "croft-analysis-runner"
ANALYSIS_RUNNER_DIR = Path(__file__).resolve().parent.parent / "analysis-runner"
CACHE_CHECK_ENTRYPOINT = "/usr/local/bin/cache-check-entrypoint.sh"
DELIMITER = "===ANALYSIS_JSON==="
TMPFS_SIZE = "2g"
REMOTE_INSTANCE_NAME = "croft-cache-check"


class CacheCheckError(Exception):
    def __init__(self, message: str, log_tail: str = ""):
        super().__init__(message)
        self.log_tail = log_tail


def _container_name(workspace_id: str) -> str:
    return f"cache-check-{workspace_id}"


def _network_name(workspace_id: str) -> str:
    return f"cache-check-net-{workspace_id}"


def _output_volume_name(workspace_id: str) -> str:
    return f"cache-check-output-{workspace_id}"


def _validate_workspace_id(workspace_id: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{24}", workspace_id):
        raise ValueError("Invalid workspace id")


def _tmpfs(mount: str, size: str = TMPFS_SIZE) -> list[str]:
    return ["--tmpfs", f"{mount}:size={size},uid=10001,gid=10001,exec"]


def _image_exists() -> bool:
    result = subprocess.run(["docker", "image", "inspect", IMAGE], capture_output=True, timeout=15)
    return result.returncode == 0


def _host_arch() -> str:
    result = subprocess.run(
        ["docker", "version", "--format", "{{.Server.Arch}}"], capture_output=True, text=True, timeout=15
    )
    arch = result.stdout.strip()
    return arch if arch in ("amd64", "arm64") else "amd64"


def _build_image() -> None:
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
        raise CacheCheckError(
            f"Failed to build the analysis sandbox image (exit {build.returncode})",
            log_tail=build.stderr[-4000:],
        )


def read_log_tail(workspace_id: str, tail_lines: int = 300) -> str:
    _validate_workspace_id(workspace_id)
    result = subprocess.run(
        ["docker", "logs", "--tail", str(tail_lines), _container_name(workspace_id)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if result.returncode != 0:
        return ""
    return (result.stdout + result.stderr)[-8000:]


def _cleanup(workspace_id: str) -> None:
    subprocess.run(["docker", "rm", "-f", _container_name(workspace_id)], capture_output=True, timeout=30)
    subprocess.run(["docker", "network", "rm", _network_name(workspace_id)], capture_output=True, timeout=30)
    subprocess.run(
        ["docker", "volume", "rm", "-f", _output_volume_name(workspace_id)], capture_output=True, timeout=30
    )


def _prepare_output_volume(workspace_id: str) -> str:
    name = _output_volume_name(workspace_id)
    subprocess.run(["docker", "volume", "create", name], capture_output=True, timeout=30)
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--user",
            "root",
            "-v",
            f"{name}:/data",
            "--entrypoint",
            "chown",
            IMAGE,
            "10001:10001",
            "/data",
        ],
        capture_output=True,
        timeout=30,
    )
    return name


TRANSIENT_FAILURE_MARKERS = (
    "could not download Bazel",
    "unexpected EOF",
    "TLS handshake",
    "connection reset by peer",
    "i/o timeout",
    "Temporary failure in name resolution",
    "context deadline exceeded",
    "Could not resolve host",
)
MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 3


def _run_once(
    workspace_id: str,
    repo_url: str,
    token: str,
    branch: str,
    target: str,
    grpc_port: int,
    timeout_seconds: int,
) -> subprocess.CompletedProcess:
    container_name = _container_name(workspace_id)
    network_name = _network_name(workspace_id)

    _cleanup(workspace_id)
    subprocess.run(["docker", "network", "create", network_name], capture_output=True, text=True, timeout=30)
    output_volume = _prepare_output_volume(workspace_id)

    cmd = [
        "docker",
        "run",
        "--rm",
        "--name",
        container_name,
        "--network",
        network_name,
        # The one flag that sets this job apart from every other sandbox job in this app -- see
        # this module's docstring. Gives the container a real path to the host's published ports,
        # specifically so it can reach the workspace's own Buildfarm server.
        "--add-host",
        "host.docker.internal:host-gateway",
        "--cap-drop=ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        "10001:10001",
        "--read-only",
        "-v",
        f"{output_volume}:/tmp",
        *_tmpfs("/home/analyzer/.cache"),
        *_tmpfs("/workspace"),
        "--cpus",
        settings.cache_check_cpu_limit,
        "--memory",
        settings.cache_check_memory_limit,
        "--pids-limit",
        settings.cache_check_pids_limit,
        "-e",
        f"REPO_URL={repo_url}",
        "-e",
        f"REPO_TOKEN={token}",
        "-e",
        f"BRANCH={branch}",
        "-e",
        f"TARGET={target}",
        "-e",
        f"REMOTE_CACHE_GRPC=grpc://host.docker.internal:{grpc_port}",
        "-e",
        f"REMOTE_INSTANCE_NAME={REMOTE_INSTANCE_NAME}",
        "--entrypoint",
        CACHE_CHECK_ENTRYPOINT,
        IMAGE,
    ]

    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        log.warning("cache-check job for workspace %s exceeded %ss, killing it", workspace_id, timeout_seconds)
        raise CacheCheckError("Cache check exceeded the time limit") from None
    finally:
        subprocess.run(["docker", "network", "rm", network_name], capture_output=True, timeout=30)
        subprocess.run(["docker", "volume", "rm", "-f", output_volume], capture_output=True, timeout=30)


def run_cache_check(
    workspace_id: str,
    repo_url: str,
    token: str,
    branch: str,
    target: str,
    grpc_port: int,
    timeout_seconds: int | None = None,
) -> dict:
    """Clones the repo and builds `target` twice (each against its own fresh output_base) pointed
    at the workspace's own Buildfarm's remote cache at `grpc_port` on the host. Returns
    {readCheck, roundTripCheck} on success. Raises CacheCheckError on any failure -- callers
    persist that as the check's errorMessage. Retries on a transient network blip, same as the
    other two sandbox jobs."""
    _validate_workspace_id(workspace_id)
    if timeout_seconds is None:
        timeout_seconds = settings.cache_check_timeout_seconds
    if not _image_exists():
        _build_image()

    result: subprocess.CompletedProcess | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        result = _run_once(workspace_id, repo_url, token, branch, target, grpc_port, timeout_seconds)
        if result.returncode == 0:
            break
        transient = any(marker in result.stderr for marker in TRANSIENT_FAILURE_MARKERS)
        if not transient or attempt == MAX_ATTEMPTS:
            break
        log.warning(
            "cache-check attempt %d/%d for workspace %s hit a transient failure, retrying: %s",
            attempt,
            MAX_ATTEMPTS,
            workspace_id,
            result.stderr[-500:],
        )
        time.sleep(RETRY_DELAY_SECONDS)

    assert result is not None
    if result.returncode != 0:
        raise CacheCheckError(
            f"Cache check failed (exit {result.returncode})",
            log_tail=result.stderr[-4000:],
        )

    if DELIMITER not in result.stdout:
        raise CacheCheckError(
            "Cache check produced no result", log_tail=result.stdout[-4000:] + result.stderr[-2000:]
        )

    payload = result.stdout.split(DELIMITER, 1)[1].strip()
    try:
        return json.loads(payload)
    except json.JSONDecodeError as err:
        raise CacheCheckError(f"Could not parse cache-check output: {err}", log_tail=payload[-2000:]) from err
