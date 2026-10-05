from fastapi import HTTPException
from pymongo.database import Database

from .. import docker_manager, render
from ..docker_manager import ComposeError
from ..models import AwsCredential, ProvisionRequest
from ..port_allocator import allocate_port, reallocate_port
from ..topology import InvalidTopologyError, parse_topology
from . import save_instance


def project_name_for(workspace_id: str) -> str:
    return f"workspace-{workspace_id}"


def summarize_status(ps_entries: list[dict]) -> str:
    if not ps_entries:
        return "stopped"
    states = {entry.get("State", "").lower() for entry in ps_entries}
    if states <= {"running"}:
        return "running"
    if states & {"exited", "dead"}:
        return "error"
    return "provisioning"


class DockerBackend:
    """Everything this service has ever done -- moved here unchanged from main.py's old
    provision()/teardown()/status()/infra() route bodies, not rewritten. Behavior-preserving on
    purpose: this is the regression baseline every existing Docker workspace is checked against
    before any AWS code exists."""

    def provision(self, request: ProvisionRequest, db: Database) -> dict:
        try:
            topology = parse_topology(request.nodes)
        except InvalidTopologyError as e:
            raise HTTPException(status_code=400, detail={"issues": e.issues})

        workspace_id = request.workspaceId
        project_name = project_name_for(workspace_id)
        grpc_port = allocate_port(db, workspace_id, docker_manager.published_host_ports())

        save_instance(
            db,
            workspace_id,
            provider="docker",
            status="provisioning",
            container_ids=[],
            grpc_port=grpc_port,
            compose_project_name=project_name,
        )

        # The bazel-remote compose service (when enabled) is always reachable by its own compose
        # service name, resolved by Docker's internal DNS -- same pattern as "redis"/"server"
        # already being addressed by service name rather than an IP.
        remote_cache_tier = topology.cache.config.get("remoteCacheTier") if topology.cache else None
        remote_cache_grpc_target = "grpc://bazel-remote:9092" if remote_cache_tier is not None else None
        config_yml = render.render_config_yml(topology, remote_cache_grpc_target=remote_cache_grpc_target)
        compose_yml = render.render_docker_compose_yml(topology, project_name, grpc_port, config_yml)
        path = docker_manager.write_project_files(workspace_id, compose_yml, config_yml)

        try:
            for attempt in range(5):
                try:
                    docker_manager.compose_up(path, project_name)
                    break
                except ComposeError as e:
                    taken = "port is already allocated" in e.stderr or "address already in use" in e.stderr
                    if not taken or attempt == 4:
                        raise
                    try:
                        docker_manager.compose_down(path, project_name)
                    except ComposeError:
                        pass
                    grpc_port = reallocate_port(db, workspace_id, docker_manager.published_host_ports())
                    compose_yml = render.render_docker_compose_yml(topology, project_name, grpc_port, config_yml)
                    path = docker_manager.write_project_files(workspace_id, compose_yml, config_yml)
        except ComposeError as e:
            detail = f"{e}\n{e.stderr}".strip()
            instance = save_instance(
                db,
                workspace_id,
                provider="docker",
                status="error",
                container_ids=[],
                grpc_port=grpc_port,
                last_error=detail,
                compose_project_name=project_name,
            )
            raise HTTPException(status_code=502, detail={"message": detail, "instance": instance})

        ps_entries = docker_manager.compose_ps(path, project_name)
        container_ids = [e.get("ID", "") for e in ps_entries if e.get("ID")]
        status = summarize_status(ps_entries)

        return save_instance(
            db,
            workspace_id,
            provider="docker",
            status=status,
            container_ids=container_ids,
            grpc_port=grpc_port,
            platform=docker_manager.worker_platform(),
            compose_project_name=project_name,
        )

    def teardown(self, workspace_id: str, db: Database, aws_credential: AwsCredential | None = None) -> dict:
        # aws_credential is AwsBackend-only (Protocol symmetry, see backends/__init__.py); Docker
        # teardown needs no credentials.
        del aws_credential
        project_name = project_name_for(workspace_id)
        path = docker_manager.project_dir(workspace_id)

        if (path / "docker-compose.yml").exists():
            try:
                docker_manager.compose_down(path, project_name)
            except ComposeError as e:
                detail = f"{e}\n{e.stderr}".strip()
                raise HTTPException(status_code=502, detail={"message": detail})

        existing = db.buildfarm_instances.find_one({"workspaceId": workspace_id})
        grpc_port = existing["ports"]["grpc"] if existing and existing.get("ports") else None
        return save_instance(
            db,
            workspace_id,
            provider="docker",
            status="stopped",
            container_ids=[],
            grpc_port=grpc_port,
            compose_project_name=project_name,
        )

    def status(self, workspace_id: str, db: Database, existing: dict) -> dict:
        project_name = project_name_for(workspace_id)
        path = docker_manager.project_dir(workspace_id)
        if (path / "docker-compose.yml").exists() and existing.get("status") != "stopped":
            ps_entries = docker_manager.compose_ps(path, project_name)
            container_ids = [e.get("ID", "") for e in ps_entries if e.get("ID")]
            live_status = summarize_status(ps_entries)
            grpc_port = existing["ports"]["grpc"] if existing.get("ports") else None
            return save_instance(
                db,
                workspace_id,
                provider="docker",
                status=live_status,
                container_ids=container_ids,
                grpc_port=grpc_port,
                platform=docker_manager.worker_platform(),
                compose_project_name=project_name,
            )
        return existing

    def infra(self, workspace_id: str, existing: dict) -> dict:
        if not existing.get("containerIds"):
            return {"containers": []}
        return {"containers": docker_manager.container_stats(existing["containerIds"])}
