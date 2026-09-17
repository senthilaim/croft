import json
import re
import subprocess
from pathlib import Path

from .settings import settings


class ComposeError(Exception):
    def __init__(self, message: str, stdout: str = "", stderr: str = ""):
        super().__init__(message)
        self.stdout = stdout
        self.stderr = stderr


def project_dir(workspace_id: str) -> Path:
    base = Path(__file__).resolve().parent.parent / settings.runtime_dir
    path = base / f"workspace-{workspace_id}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_project_files(workspace_id: str, compose_yml: str, config_yml: str) -> Path:
    path = project_dir(workspace_id)
    (path / "docker-compose.yml").write_text(compose_yml)
    (path / "config.yml").write_text(config_yml)
    return path


def _run_compose(path: Path, project_name: str, *args: str, timeout: int = 300) -> subprocess.CompletedProcess:
    cmd = ["docker", "compose", "-p", project_name, "-f", str(path / "docker-compose.yml"), *args]
    result = subprocess.run(cmd, cwd=path, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise ComposeError(
            f"docker compose {' '.join(args)} failed with exit code {result.returncode}",
            stdout=result.stdout,
            stderr=result.stderr,
        )
    return result


def compose_up(path: Path, project_name: str) -> None:
    _run_compose(path, project_name, "up", "-d", "--wait", "--wait-timeout", "180", timeout=240)


def compose_down(path: Path, project_name: str) -> None:
    _run_compose(path, project_name, "down", "-v", "--remove-orphans", timeout=120)


def compose_ps(path: Path, project_name: str) -> list[dict]:
    result = _run_compose(path, project_name, "ps", "--format", "json", "--all", timeout=60)
    output = result.stdout.strip()
    if not output:
        return []
    try:
        parsed = json.loads(output)
        return parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        return [json.loads(line) for line in output.splitlines() if line.strip()]


_SIZE_PATTERN = re.compile(r"^([\d.]+)\s*([A-Za-z]+)$")
_SIZE_UNITS_MB = {"B": 1 / 1_000_000, "KiB": 1 / 1024, "KB": 1 / 1000, "MiB": 1, "MB": 1, "GiB": 1024, "GB": 1000}


def _parse_size_to_mb(text: str) -> float:
    match = _SIZE_PATTERN.match(text.strip())
    if not match:
        return 0.0
    value, unit = match.groups()
    try:
        return float(value) * _SIZE_UNITS_MB.get(unit, 0.0)
    except ValueError:
        return 0.0


def role_from_container_name(name: str) -> str:
    for role in ("server", "worker", "redis"):
        if f"-{role}-" in name:
            return role
    return "unknown"


def container_stats(container_ids: list[str]) -> list[dict]:
    """Live CPU/memory usage for the given containers, via `docker stats --no-stream`."""
    if not container_ids:
        return []

    result = subprocess.run(
        ["docker", "stats", "--no-stream", "--format", "{{json .}}", *container_ids],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        return []

    stats = []
    for line in result.stdout.strip().splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        mem_usage, _, mem_limit = entry.get("MemUsage", "0B / 0B").partition(" / ")
        stats.append(
            {
                "id": entry.get("ID", ""),
                "name": entry.get("Name", ""),
                "role": role_from_container_name(entry.get("Name", "")),
                "cpuPercent": float(entry.get("CPUPerc", "0%").rstrip("%") or 0),
                "memUsageMb": round(_parse_size_to_mb(mem_usage), 1),
                "memLimitMb": round(_parse_size_to_mb(mem_limit), 1),
                "memPercent": float(entry.get("MemPerc", "0%").rstrip("%") or 0),
            }
        )
    return stats
