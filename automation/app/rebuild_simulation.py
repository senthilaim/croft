"""Launches the sandboxed analysis-runner container (see automation/analysis-runner/) to answer
"why did this rebuild": builds a target once, makes a real content change to one file, builds it
again with --explain, and returns which actions re-ran and why.

Reuses the same croft-analysis-runner image as repo_analysis.py (it already has the toolchains a
real build needs) via --entrypoint simulate-entrypoint.sh instead of the default query entrypoint.
Deliberately duplicates repo_analysis.py's subprocess/hardening/retry conventions rather than
sharing a helper module -- see that file's own note on this; factor out only if a third sandbox-job
consumer shows up.
"""

import json
import logging
import re
import subprocess
import time
from pathlib import Path

from .settings import settings

log = logging.getLogger("rebuild_simulation")

IMAGE = "croft-analysis-runner"
ANALYSIS_RUNNER_DIR = Path(__file__).resolve().parent.parent / "analysis-runner"
SIMULATE_ENTRYPOINT = "/usr/local/bin/simulate-entrypoint.sh"
DELIMITER = "===ANALYSIS_JSON==="
TMPFS_SIZE = "2g"


class SimulationError(Exception):
    def __init__(self, message: str, log_tail: str = ""):
        super().__init__(message)
        self.log_tail = log_tail


def _container_name(workspace_id: str) -> str:
    return f"simulate-{workspace_id}"


def _network_name(workspace_id: str) -> str:
    return f"simulate-net-{workspace_id}"


def _output_volume_name(workspace_id: str) -> str:
    return f"simulate-output-{workspace_id}"


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
        raise SimulationError(
            f"Failed to build the analysis sandbox image (exit {build.returncode})",
            log_tail=build.stderr[-4000:],
        )


def read_log_tail(workspace_id: str, tail_lines: int = 300) -> str:
    """Same reasoning as repo_analysis.read_log_tail: safe to read concurrently with the foreground
    `docker run` that owns the container; "" for not-started-yet or already-cleaned-up, both
    normal."""
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
    """Same reasoning as repo_analysis._prepare_output_volume: a real build's output_base (two
    builds' worth of compiled objects plus every external dependency) can be large -- a disk-backed
    named volume, not tmpfs, avoids the "No space left on device" failure mode that hit the
    analysis job before it moved to this same approach."""
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


# Same list as repo_analysis.py's TRANSIENT_FAILURE_MARKERS -- a real build clones and downloads
# Bazel the same way analysis does, so it's exposed to the same class of network blips.
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
    file_path: str,
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
        settings.simulation_cpu_limit,
        "--memory",
        settings.simulation_memory_limit,
        "--pids-limit",
        settings.simulation_pids_limit,
        "-e",
        f"REPO_URL={repo_url}",
        "-e",
        f"REPO_TOKEN={token}",
        "-e",
        f"BRANCH={branch}",
        "-e",
        f"TARGET={target}",
        "-e",
        f"FILE_PATH={file_path}",
        "--entrypoint",
        SIMULATE_ENTRYPOINT,
        IMAGE,
    ]

    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        log.warning("simulation job for workspace %s exceeded %ss, killing it", workspace_id, timeout_seconds)
        raise SimulationError("Rebuild simulation exceeded the time limit") from None
    finally:
        subprocess.run(["docker", "network", "rm", network_name], capture_output=True, timeout=30)
        subprocess.run(["docker", "volume", "rm", "-f", output_volume], capture_output=True, timeout=30)


def run_simulation(
    workspace_id: str,
    repo_url: str,
    token: str,
    branch: str,
    target: str,
    file_path: str,
    timeout_seconds: int | None = None,
) -> dict:
    """Clones the repo, builds `target` once, appends a newline to `file_path`, builds `target`
    again with --explain, and returns the parsed rebuild summary. Raises SimulationError on any
    failure (bad repo, bad target/path, baseline build failure, timeout) -- callers persist that as
    the simulation's `errorMessage`. Retries on a transient network blip, same as run_analysis."""
    _validate_workspace_id(workspace_id)
    if timeout_seconds is None:
        timeout_seconds = settings.simulation_timeout_seconds
    if not _image_exists():
        _build_image()

    result: subprocess.CompletedProcess | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        result = _run_once(workspace_id, repo_url, token, branch, target, file_path, timeout_seconds)
        if result.returncode == 0:
            break
        transient = any(marker in result.stderr for marker in TRANSIENT_FAILURE_MARKERS)
        if not transient or attempt == MAX_ATTEMPTS:
            break
        log.warning(
            "simulation attempt %d/%d for workspace %s hit a transient failure, retrying: %s",
            attempt,
            MAX_ATTEMPTS,
            workspace_id,
            result.stderr[-500:],
        )
        time.sleep(RETRY_DELAY_SECONDS)

    assert result is not None
    if result.returncode != 0:
        raise SimulationError(
            f"Rebuild simulation failed (exit {result.returncode})",
            log_tail=result.stderr[-4000:],
        )

    if DELIMITER not in result.stdout:
        raise SimulationError(
            "Rebuild simulation produced no result", log_tail=result.stdout[-4000:] + result.stderr[-2000:]
        )

    payload = result.stdout.split(DELIMITER, 1)[1].strip()
    try:
        return json.loads(payload)
    except json.JSONDecodeError as err:
        raise SimulationError(f"Could not parse simulation output: {err}", log_tail=payload[-2000:]) from err
