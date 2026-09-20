from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from .topology import Topology

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))

DEFAULT_CACHE_SIZE_BYTES = 2 * 1024 * 1024 * 1024  # 2GB, matches Buildfarm's own default


def render_config_yml(topology: Topology) -> str:
    cache_bytes = DEFAULT_CACHE_SIZE_BYTES
    if topology.cache is not None:
        size_gb = topology.cache.config.get("sizeGb", 2)
        cache_bytes = int(size_gb) * 1024 * 1024 * 1024

    worker_execution_enabled = bool(topology.worker.config.get("executionEnabled", True))

    template = _env.get_template("config.yml.j2")
    return template.render(
        cache_max_size_bytes=cache_bytes,
        worker_execution_enabled=worker_execution_enabled,
    )


def render_docker_compose_yml(
    topology: Topology, project_name: str, server_host_port: int, config_yml: str
) -> str:
    server_cfg = topology.server.config
    worker_cfg = topology.worker.config
    redis_cfg = topology.redis.config

    template = _env.get_template("docker-compose.yml.j2")
    return template.render(
        project_name=project_name,
        config_yml=config_yml,
        server_host_port=server_host_port,
        server_cpu_limit=server_cfg.get("cpuLimit", "1"),
        server_memory_mb=int(server_cfg.get("memoryLimitMb", 512)),
        worker_replicas=int(worker_cfg.get("replicas", 1)),
        worker_cpu_limit=worker_cfg.get("cpuLimit", "1"),
        worker_memory_mb=int(worker_cfg.get("memoryLimitMb", 1024)),
        redis_memory_mb=int(redis_cfg.get("memoryLimitMb", 256)),
    )
