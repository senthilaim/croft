from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from pymongo.database import Database

from . import bes_server, docker_manager, render
from .auth import require_internal_token
from .db import get_db
from .docker_manager import ComposeError
from .models import ProvisionRequest, TeardownRequest
from .port_allocator import allocate_port
from .settings import settings
from .topology import InvalidTopologyError, parse_topology

app = FastAPI(title="Bazel Bootstrap Automation Service")


@app.on_event("startup")
def _start_bes_server() -> None:
    bes_server.start_in_background()


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


def save_instance(
    db: Database,
    workspace_id: str,
    *,
    status: str,
    container_ids: list[str],
    grpc_port: int | None = None,
    last_error: str | None = None,
) -> dict:
    doc = {
        "workspaceId": workspace_id,
        "composeProjectName": project_name_for(workspace_id),
        "containerIds": container_ids,
        "status": status,
        "lastError": last_error,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    if grpc_port is not None:
        doc["ports"] = {"grpc": grpc_port}

    db.buildfarm_instances.find_one_and_update(
        {"workspaceId": workspace_id},
        {"$set": doc},
        upsert=True,
    )
    return db.buildfarm_instances.find_one({"workspaceId": workspace_id}, {"_id": 0})


@app.get("/health")
def health():
    return {"status": "ok", "besPort": settings.bes_port}


@app.post("/provision", dependencies=[Depends(require_internal_token)])
def provision(request: ProvisionRequest, db: Database = Depends(get_db)):
    try:
        topology = parse_topology(request.nodes)
    except InvalidTopologyError as e:
        raise HTTPException(status_code=400, detail={"issues": e.issues})

    workspace_id = request.workspaceId
    project_name = project_name_for(workspace_id)
    grpc_port = allocate_port(db, workspace_id)

    save_instance(db, workspace_id, status="provisioning", container_ids=[], grpc_port=grpc_port)

    config_yml = render.render_config_yml(topology)
    compose_yml = render.render_docker_compose_yml(topology, project_name, grpc_port)
    path = docker_manager.write_project_files(workspace_id, compose_yml, config_yml)

    try:
        docker_manager.compose_up(path, project_name)
    except ComposeError as e:
        detail = f"{e}\n{e.stderr}".strip()
        instance = save_instance(
            db, workspace_id, status="error", container_ids=[], grpc_port=grpc_port, last_error=detail
        )
        raise HTTPException(status_code=502, detail={"message": detail, "instance": instance})

    ps_entries = docker_manager.compose_ps(path, project_name)
    container_ids = [e.get("ID", "") for e in ps_entries if e.get("ID")]
    status = summarize_status(ps_entries)

    return save_instance(
        db, workspace_id, status=status, container_ids=container_ids, grpc_port=grpc_port
    )


@app.post("/teardown", dependencies=[Depends(require_internal_token)])
def teardown(request: TeardownRequest, db: Database = Depends(get_db)):
    workspace_id = request.workspaceId
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
        db, workspace_id, status="stopped", container_ids=[], grpc_port=grpc_port
    )


@app.get("/infra/{workspace_id}", dependencies=[Depends(require_internal_token)])
def infra(workspace_id: str, db: Database = Depends(get_db)):
    existing = db.buildfarm_instances.find_one({"workspaceId": workspace_id}, {"_id": 0})
    if not existing or not existing.get("containerIds"):
        return {"containers": []}
    return {"containers": docker_manager.container_stats(existing["containerIds"])}


@app.get("/status/{workspace_id}", dependencies=[Depends(require_internal_token)])
def status(workspace_id: str, db: Database = Depends(get_db)):
    existing = db.buildfarm_instances.find_one({"workspaceId": workspace_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="No buildfarm instance for this workspace")

    project_name = project_name_for(workspace_id)
    path = docker_manager.project_dir(workspace_id)
    if (path / "docker-compose.yml").exists() and existing.get("status") != "stopped":
        ps_entries = docker_manager.compose_ps(path, project_name)
        container_ids = [e.get("ID", "") for e in ps_entries if e.get("ID")]
        live_status = summarize_status(ps_entries)
        grpc_port = existing["ports"]["grpc"] if existing.get("ports") else None
        return save_instance(
            db, workspace_id, status=live_status, container_ids=container_ids, grpc_port=grpc_port
        )

    return existing
