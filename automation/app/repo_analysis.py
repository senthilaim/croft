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
import time
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


def read_log_tail(workspace_id: str, tail_lines: int = 300) -> str:
    """Best-effort read of the still-running (or just-finished) analysis container's console
    output, for the frontend's live log panel. Docker's log driver can be read concurrently with
    the foreground `docker run` in run_analysis() that owns the container -- this doesn't interfere
    with it. Returns "" if the container doesn't exist yet (job not started) or has already been
    cleaned up (job finished and this is a stale poll) -- both are normal, not errors."""
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


def _output_volume_name(workspace_id: str) -> str:
    return f"analysis-output-{workspace_id}"


def _cleanup(workspace_id: str) -> None:
    subprocess.run(["docker", "rm", "-f", _container_name(workspace_id)], capture_output=True, timeout=30)
    subprocess.run(["docker", "network", "rm", _network_name(workspace_id)], capture_output=True, timeout=30)
    subprocess.run(
        ["docker", "volume", "rm", "-f", _output_volume_name(workspace_id)], capture_output=True, timeout=30
    )


def _prepare_output_volume(workspace_id: str) -> str:
    """Bazel's output_base (--output_base=/tmp/bazel-output in the entrypoint) is where it
    extracts *every* external dependency -- for a repo the size of TensorFlow/XLA that includes
    LLVM and other multi-gigabyte fetches, easily exceeding the RAM-backed tmpfs this used to be
    ("No space left on device" extracting llvm-raw was a 2GB tmpfs, not a real disk, filling up).
    A per-job named Docker volume is disk-backed instead, with no size ceiling to hand-tune. It
    needs one throwaway root container to chown it to the analyzer uid first, since a fresh volume
    is root-owned by default and the main job runs as a non-root user."""
    name = _output_volume_name(workspace_id)
    subprocess.run(["docker", "volume", "create", name], capture_output=True, timeout=30)
    # The image itself runs as the non-root `analyzer` user (Dockerfile: USER analyzer), so this
    # one-off prep step must explicitly ask for root -- otherwise chown has no permission to
    # change ownership of the (root-owned, freshly created) volume at all. The main analysis
    # container below still runs fully non-root; only this throwaway step, which does nothing but
    # a single chown on an empty volume and exits, runs as root.
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


# Substrings seen in real failures caused by a network blip during the run, not by anything wrong
# with the repo or the query itself -- retried automatically rather than surfaced as a failure,
# since the sandbox's Bazel cache is wiped every run (ephemeral tmpfs) and so re-downloads the
# ~80MB Bazel binary from scratch on every single analysis.
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
    workspace_id: str, repo_url: str, token: str, branch: str, timeout_seconds: int
) -> subprocess.CompletedProcess:
    container_name = _container_name(workspace_id)
    network_name = _network_name(workspace_id)

    # Always start clean: a previous attempt's container/network/volume may still exist if it
    # crashed or timed out before its own cleanup ran.
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
        # /tmp is a disk-backed volume, not tmpfs: Bazel's output_base (all external deps, which
        # for a large repo can be many GB) lives there -- see _prepare_output_volume(). The other
        # two stay tmpfs: the git clone and Bazelisk's own binary cache are both small regardless
        # of the target repo's size.
        "-v",
        f"{output_volume}:/tmp",
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
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        log.warning("analysis job for workspace %s exceeded %ss, killing it", workspace_id, timeout_seconds)
        raise AnalysisError("Analysis exceeded the time limit") from None
    finally:
        # Every attempt must end with the network and (multi-GB, disk-backed) volume reclaimed --
        # not just the container, which only cleans itself up via --rm on success. Leaving this to
        # "the next run for this workspace cleans up the previous one" (as _cleanup() at the top of
        # this function does) would silently leak a volume per analysis for any workspace that's
        # only ever analyzed once.
        subprocess.run(["docker", "network", "rm", network_name], capture_output=True, timeout=30)
        subprocess.run(["docker", "volume", "rm", "-f", output_volume], capture_output=True, timeout=30)


def run_analysis(
    workspace_id: str,
    repo_url: str,
    token: str,
    branch: str,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict:
    """Clones and analyzes `repo_url` inside a fresh, hardened, network-isolated container.
    Returns the parsed analysis dict on success. Raises AnalysisError on any failure (bad repo,
    query failure, timeout) -- callers persist that as the analysis's `errorMessage`. Retries a
    handful of times on a failure that looks like a transient network blip (see
    TRANSIENT_FAILURE_MARKERS) rather than a real problem with the repo or query."""
    _validate_workspace_id(workspace_id)
    if not _image_exists():
        _build_image()

    result: subprocess.CompletedProcess | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        result = _run_once(workspace_id, repo_url, token, branch, timeout_seconds)
        if result.returncode == 0 or result.returncode == 3:
            break
        transient = any(marker in result.stderr for marker in TRANSIENT_FAILURE_MARKERS)
        if not transient or attempt == MAX_ATTEMPTS:
            break
        log.warning(
            "analysis attempt %d/%d for workspace %s hit a transient failure, retrying: %s",
            attempt,
            MAX_ATTEMPTS,
            workspace_id,
            result.stderr[-500:],
        )
        time.sleep(RETRY_DELAY_SECONDS)

    assert result is not None
    if result.returncode != 0 and result.returncode != 3:
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
