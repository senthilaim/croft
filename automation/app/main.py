import re
from datetime import datetime, timedelta, timezone

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Response
from pymongo.database import Database

from . import bes_server, cas_client, docker_manager, infra_sampler, render, repo_analysis
from .auth import require_internal_token
from .db import get_db
from .docker_manager import ComposeError
from .models import AnalyzeRepoRequest, ProvisionRequest, TeardownRequest
from .repo_analysis import AnalysisError
from .port_allocator import allocate_port, reallocate_port
from .settings import settings
from .topology import InvalidTopologyError, parse_topology

app = FastAPI(title="Bazel Bootstrap Automation Service")

TREND_BUCKET_COUNT = 60
SAMPLE_MIN_BUCKET_SECONDS = 60  # matches infra_sampler's own sampling interval
# Deliberately more generous than the log-read caps (ACTION_LOG_READ_CAP etc in bes_server.py) --
# this is for actual build output binaries, not text -- but still a bounded, documented limit for
# a local-dev tool, not a general-purpose artifact store.
ARTIFACT_DOWNLOAD_CAP = 50_000_000


@app.on_event("startup")
def _start_background_services() -> None:
    bes_server.start_in_background()
    infra_sampler.start_in_background()


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
    platform: dict | None = None,
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
    if platform is not None:
        doc["platform"] = platform

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
    grpc_port = allocate_port(db, workspace_id, docker_manager.published_host_ports())

    save_instance(db, workspace_id, status="provisioning", container_ids=[], grpc_port=grpc_port)

    config_yml = render.render_config_yml(topology)
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
            db, workspace_id, status="error", container_ids=[], grpc_port=grpc_port, last_error=detail
        )
        raise HTTPException(status_code=502, detail={"message": detail, "instance": instance})

    ps_entries = docker_manager.compose_ps(path, project_name)
    container_ids = [e.get("ID", "") for e in ps_entries if e.get("ID")]
    status = summarize_status(ps_entries)

    return save_instance(
        db,
        workspace_id,
        status=status,
        container_ids=container_ids,
        grpc_port=grpc_port,
        platform=docker_manager.worker_platform(),
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


@app.get("/infra/{workspace_id}/trends", dependencies=[Depends(require_internal_token)])
def infra_trends(workspace_id: str, hours: int = 24, db: Database = Depends(get_db)):
    hours = max(1, min(168, hours))
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    # Fixed bucket count regardless of range, so a 7-day query doesn't return raw 60s samples.
    bucket_seconds = max(SAMPLE_MIN_BUCKET_SECONDS, (hours * 3600) // TREND_BUCKET_COUNT)

    rows = db.infra_samples.aggregate(
        [
            {"$match": {"workspaceId": workspace_id, "sampledAt": {"$gte": since}}},
            {
                "$addFields": {
                    "sampledAtMs": {"$toLong": {"$toDate": "$sampledAt"}},
                }
            },
            {
                "$addFields": {
                    "bucketMs": {
                        "$subtract": [
                            "$sampledAtMs",
                            {"$mod": ["$sampledAtMs", bucket_seconds * 1000]},
                        ]
                    }
                }
            },
            {
                "$group": {
                    "_id": {"name": "$name", "role": "$role", "bucketMs": "$bucketMs"},
                    "cpuPercent": {"$avg": "$cpuPercent"},
                    "memPercent": {"$avg": "$memPercent"},
                }
            },
            {"$sort": {"_id.bucketMs": 1}},
        ]
    )

    series: dict[str, dict] = {}
    for row in rows:
        name = row["_id"]["name"]
        entry = series.setdefault(name, {"containerName": name, "role": row["_id"]["role"], "points": []})
        entry["points"].append(
            {
                "timestamp": datetime.fromtimestamp(row["_id"]["bucketMs"] / 1000, tz=timezone.utc).isoformat(),
                "cpuPercent": round(row["cpuPercent"], 1),
                "memPercent": round(row["memPercent"], 1),
            }
        )
    return list(series.values())


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
            db,
            workspace_id,
            status=live_status,
            container_ids=container_ids,
            grpc_port=grpc_port,
            platform=docker_manager.worker_platform(),
        )

    return existing


_DEPLOYED_FILE_NAMES = ("config.yml", "docker-compose.yml")


@app.get("/analyze/{workspace_id}/log", dependencies=[Depends(require_internal_token)])
def analyze_log(workspace_id: str):
    return {"log": repo_analysis.read_log_tail(workspace_id)}


@app.post("/analyze", dependencies=[Depends(require_internal_token)])
def analyze(request: AnalyzeRepoRequest):
    try:
        return repo_analysis.run_analysis(request.workspaceId, request.repoUrl, request.token, request.branch)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except AnalysisError as e:
        raise HTTPException(status_code=502, detail={"message": str(e), "logTail": e.log_tail})


@app.get("/files/{workspace_id}", dependencies=[Depends(require_internal_token)])
def deployed_files(workspace_id: str):
    """The Buildfarm config and compose file Croft generated for a workspace (read-only view)."""
    if not re.fullmatch(r"[0-9a-f]{24}", workspace_id):
        raise HTTPException(status_code=400, detail="Invalid workspace id")
    base = Path(__file__).resolve().parent.parent / settings.runtime_dir / f"workspace-{workspace_id}"
    files = []
    for name in _DEPLOYED_FILE_NAMES:
        candidate = base / name
        if candidate.is_file():
            files.append({"name": name, "content": candidate.read_text()})
    return {"files": files}


@app.get("/artifacts", dependencies=[Depends(require_internal_token)])
def fetch_artifact(uri: str):
    """Fetches one build output's bytes fresh from Buildfarm's CAS, on demand -- artifact bytes
    are never persisted, only their {name, uri, sizeBytes} metadata (see bes_server.py)."""
    data = cas_client.read_blob(uri, ARTIFACT_DOWNLOAD_CAP)
    if data is None:
        raise HTTPException(status_code=404, detail="Artifact is no longer available")
    return Response(content=data, media_type="application/octet-stream")
