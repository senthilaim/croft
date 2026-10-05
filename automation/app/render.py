from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from .topology import Topology

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))

DEFAULT_CACHE_SIZE_BYTES = 2 * 1024 * 1024 * 1024  # 2GB, matches Buildfarm's own default


DEFAULT_REDIS_URI = "redis://redis:6379"  # Docker's compose service name, unchanged default


def render_config_yml(
    topology: Topology,
    redis_uri: str = DEFAULT_REDIS_URI,
    remote_cache_grpc_target: str | None = None,
) -> str:
    """One config.yml, deployed unchanged to both Server and Worker (Buildfarm's own convention --
    each process only reads the section it needs, same as today's single-instance Docker design
    where one file already serves all three roles). `redis_uri`/`remote_cache_grpc_target` are
    opaque strings to this function: for AWS they're literal placeholder tokens
    (__REDIS_ENDPOINT__, __REMOTE_CACHE_GRPC_TARGET__) that Terraform substitutes with real
    resource addresses at apply time, since this function runs before those resources exist -- see
    AwsBackend.provision() and main.tf's replace() calls."""
    cache_bytes = DEFAULT_CACHE_SIZE_BYTES
    if topology.cache is not None:
        size_gb = topology.cache.config.get("sizeGb", 2)
        cache_bytes = int(size_gb) * 1024 * 1024 * 1024

    worker_execution_enabled = bool(topology.worker.config.get("executionEnabled", True))

    template = _env.get_template("config.yml.j2")
    return template.render(
        cache_max_size_bytes=cache_bytes,
        worker_execution_enabled=worker_execution_enabled,
        redis_uri=redis_uri,
        remote_cache_grpc_target=remote_cache_grpc_target,
    )


def render_docker_compose_yml(
    topology: Topology, project_name: str, server_host_port: int, config_yml: str
) -> str:
    server_cfg = topology.server.config
    worker_cfg = topology.worker.config
    redis_cfg = topology.redis.config
    cache_cfg = topology.cache.config if topology.cache is not None else {}
    remote_cache_tier = cache_cfg.get("remoteCacheTier")

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
        # "s3"/"both" are AWS-only (assertRemoteCacheTierAllowed rejects them for Docker before
        # this ever runs) -- Docker's bazel-remote service is always the local-disk-only tier.
        remote_cache_enabled=remote_cache_tier is not None,
        cache_size_gb=int(cache_cfg.get("sizeGb", 10)),
    )


def render_aws_server_compose_yml(topology: Topology, project_name: str, grpc_port: int, config_yml: str) -> str:
    server_cfg = topology.server.config
    template = _env.get_template("aws-server-compose.yml.j2")
    return template.render(
        project_name=project_name,
        config_yml=config_yml,
        grpc_port=grpc_port,
        server_cpu_limit=server_cfg.get("cpuLimit", "1"),
        server_memory_mb=int(server_cfg.get("memoryLimitMb", 512)),
    )


def render_aws_worker_compose_yml(topology: Topology, project_name: str, config_yml: str) -> str:
    worker_cfg = topology.worker.config
    template = _env.get_template("aws-worker-compose.yml.j2")
    return template.render(
        project_name=project_name,
        config_yml=config_yml,
        worker_cpu_limit=worker_cfg.get("cpuLimit", "1"),
        worker_memory_mb=int(worker_cfg.get("memoryLimitMb", 1024)),
    )


def render_bazel_remote_compose_yml(
    project_name: str,
    local_size_gb: int,
    s3_enabled: bool,
    s3_bucket_name: str,
    region: str,
    grpc_port: int = 9092,
    http_port: int = 9093,
) -> str:
    """s3_bucket_name is the literal placeholder token __S3_BUCKET_NAME__ when called from
    AwsBackend -- Terraform substitutes it with the real bucket name at apply time, same pattern as
    render_config_yml's redis_uri/remote_cache_grpc_target."""
    template = _env.get_template("bazel-remote-compose.yml.j2")
    return template.render(
        project_name=project_name,
        local_size_gb=local_size_gb,
        s3_enabled=s3_enabled,
        s3_bucket_name=s3_bucket_name,
        region=region,
        grpc_port=grpc_port,
        http_port=http_port,
    )


def render_aws_user_data(compose_yml: str) -> str:
    """Wraps any rendered docker-compose.yml in a small EC2 bootstrap script -- content-agnostic,
    reused unchanged for Server, Worker, and the optional cache instance (see
    render_aws_server_compose_yml/render_aws_worker_compose_yml/render_bazel_remote_compose_yml).
    Terraform only owns what AWS resources exist, not how Buildfarm's containers start, so nothing
    Bazel/Buildfarm-specific gets re-expressed in HCL -- see AwsBackend.provision()."""
    template = _env.get_template("aws-user-data.sh.j2")
    return template.render(compose_yml=compose_yml)
