"""Covers the step-5 template changes: config.yml's redis_uri/remote-cache-GRPC-entry
parameterization, the new per-instance AWS compose renders (Server-only, Worker-only, the
dedicated bazel-remote cache), and Docker's own optional local-tier bazel-remote service. Asserts
on parsed YAML structure rather than raw strings where it matters, so these stay robust to
whitespace/formatting changes in the templates themselves."""

import yaml

from . import render
from .models import BuildfarmEdge, BuildfarmNode, NodePosition
from .topology import parse_topology

SERVER = BuildfarmNode(id="server-1", type="server", position=NodePosition(x=0, y=0), config={"cpuLimit": "1", "memoryLimitMb": 512})
WORKER = BuildfarmNode(
    id="worker-1", type="worker", position=NodePosition(x=0, y=0),
    config={"cpuLimit": "2", "memoryLimitMb": 2048, "replicas": 1, "executionEnabled": True},
)
REDIS = BuildfarmNode(id="redis-1", type="redis", position=NodePosition(x=0, y=0), config={"memoryLimitMb": 256})
EDGES = [
    BuildfarmEdge(id="e1", source="server-1", target="worker-1"),
    BuildfarmEdge(id="e2", source="server-1", target="redis-1"),
]


def _topology(cache_config: dict | None = None):
    nodes = [SERVER, WORKER, REDIS]
    if cache_config is not None:
        nodes.append(BuildfarmNode(id="cache-1", type="cache", position=NodePosition(x=0, y=0), config=cache_config))
    return parse_topology(nodes)


class TestRenderConfigYml:
    def test_default_redis_uri_and_no_grpc_storage_matches_todays_docker_behavior(self):
        topology = _topology()
        config = yaml.safe_load(render.render_config_yml(topology))
        assert config["backplane"]["redisUri"] == "redis://redis:6379"
        assert len(config["worker"]["storages"]) == 1
        assert config["worker"]["storages"][0]["type"] == "FILESYSTEM"

    def test_custom_redis_uri_is_substituted(self):
        topology = _topology()
        config = yaml.safe_load(render.render_config_yml(topology, redis_uri="redis://__REDIS_ENDPOINT__:6379"))
        assert config["backplane"]["redisUri"] == "redis://__REDIS_ENDPOINT__:6379"

    def test_remote_cache_grpc_target_adds_a_second_storage_entry(self):
        topology = _topology()
        config = yaml.safe_load(
            render.render_config_yml(topology, remote_cache_grpc_target="grpc://cache-host:9092")
        )
        storages = config["worker"]["storages"]
        assert len(storages) == 2
        assert storages[0]["type"] == "FILESYSTEM"
        assert storages[1] == {"type": "GRPC", "target": "grpc://cache-host:9092"}

    def test_remote_cache_grpc_target_with_a_literal_terraform_placeholder_round_trips_unchanged(self):
        # Confirms render_config_yml treats this purely as an opaque string -- Python never tries
        # to resolve it, Terraform's own replace() does that later (see AwsBackend.provision()).
        topology = _topology()
        config = yaml.safe_load(
            render.render_config_yml(
                topology,
                redis_uri="redis://__REDIS_ENDPOINT__:6379",
                remote_cache_grpc_target="grpc://__REMOTE_CACHE_GRPC_TARGET__:9092",
            )
        )
        assert config["backplane"]["redisUri"] == "redis://__REDIS_ENDPOINT__:6379"
        assert config["worker"]["storages"][1]["target"] == "grpc://__REMOTE_CACHE_GRPC_TARGET__:9092"


class TestRenderDockerComposeYml:
    def test_no_cache_tier_produces_no_bazel_remote_service_or_volume(self):
        topology = _topology(cache_config={"sizeGb": 10})
        config_yml = render.render_config_yml(topology)
        compose = yaml.safe_load(render.render_docker_compose_yml(topology, "workspace-1", 21000, config_yml))
        assert "bazel-remote" not in compose["services"]
        assert "volumes" not in compose or compose["volumes"] is None

    def test_local_tier_adds_the_bazel_remote_service_with_no_s3_flags(self):
        topology = _topology(cache_config={"sizeGb": 15, "remoteCacheTier": "local"})
        config_yml = render.render_config_yml(topology)
        compose = yaml.safe_load(render.render_docker_compose_yml(topology, "workspace-1", 21000, config_yml))
        bazel_remote = compose["services"]["bazel-remote"]
        command = bazel_remote["command"]
        assert "--max_size=15" in command
        assert not any(str(c).startswith("--s3.") for c in command)
        assert "bazel-remote-data" in compose["volumes"]

    def test_existing_server_worker_redis_services_are_unaffected_by_the_cache_addition(self):
        topology = _topology(cache_config={"sizeGb": 10, "remoteCacheTier": "local"})
        config_yml = render.render_config_yml(topology)
        compose = yaml.safe_load(render.render_docker_compose_yml(topology, "workspace-1", 21000, config_yml))
        assert set(["server", "worker", "redis"]).issubset(compose["services"].keys())
        assert compose["services"]["server"]["ports"] == ["21000:8980"]


class TestRenderAwsServerComposeYml:
    def test_renders_only_the_server_service_on_the_given_port(self):
        topology = _topology()
        config_yml = render.render_config_yml(topology, redis_uri="redis://__REDIS_ENDPOINT__:6379")
        compose = yaml.safe_load(render.render_aws_server_compose_yml(topology, "workspace-1", 8980, config_yml))
        assert list(compose["services"].keys()) == ["server"]
        assert compose["services"]["server"]["ports"] == ["8980:8980"]
        assert "__REDIS_ENDPOINT__" in compose["configs"]["buildfarm_config"]["content"]


class TestRenderAwsWorkerComposeYml:
    def test_renders_only_the_worker_service_with_no_published_ports(self):
        topology = _topology()
        config_yml = render.render_config_yml(topology, redis_uri="redis://__REDIS_ENDPOINT__:6379")
        compose = yaml.safe_load(render.render_aws_worker_compose_yml(topology, "workspace-1", config_yml))
        assert list(compose["services"].keys()) == ["worker"]
        assert "ports" not in compose["services"]["worker"]
        assert "replicas" not in compose["services"]["worker"].get("deploy", {})


class TestRenderBazelRemoteComposeYml:
    def test_local_only_has_no_s3_flags(self):
        compose = yaml.safe_load(
            render.render_bazel_remote_compose_yml(
                "workspace-1", local_size_gb=20, s3_enabled=False, s3_bucket_name="", region="us-east-1"
            )
        )
        command = compose["services"]["bazel-remote"]["command"]
        assert not any(str(c).startswith("--s3.") for c in command)
        assert "--max_size=20" in command

    def test_s3_enabled_adds_the_s3_flags_with_iam_role_auth(self):
        compose = yaml.safe_load(
            render.render_bazel_remote_compose_yml(
                "workspace-1", local_size_gb=20, s3_enabled=True,
                s3_bucket_name="__S3_BUCKET_NAME__", region="us-east-1",
            )
        )
        command = compose["services"]["bazel-remote"]["command"]
        assert "--s3.bucket=__S3_BUCKET_NAME__" in command
        assert "--s3.endpoint=s3.us-east-1.amazonaws.com" in command
        assert "--s3.auth_method=iam_role" in command

    def test_s3_bucket_placeholder_is_never_resolved_by_python(self):
        # Confirms the __S3_BUCKET_NAME__ token round-trips unchanged -- Terraform's replace()
        # resolves it later (see main.tf's aws_instance.cache), not render.py.
        compose = yaml.safe_load(
            render.render_bazel_remote_compose_yml(
                "workspace-1", local_size_gb=10, s3_enabled=True,
                s3_bucket_name="__S3_BUCKET_NAME__", region="us-east-1",
            )
        )
        assert any("__S3_BUCKET_NAME__" in str(c) for c in compose["services"]["bazel-remote"]["command"])


class TestRenderAwsUserData:
    def test_wraps_any_compose_yml_unchanged_content_agnostic(self):
        for compose_yml in ["name: a\nservices:\n  x: {}\n", "name: b\nservices:\n  y: {}\n"]:
            script = render.render_aws_user_data(compose_yml)
            assert compose_yml.strip() in script
            assert "docker compose up -d" in script
