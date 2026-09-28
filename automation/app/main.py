import re
from datetime import datetime, timedelta, timezone

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Response
from pymongo.database import Database

from . import (
    bes_server,
    cache_check,
    cas_client,
    credentials,
    infra_sampler,
    rebuild_simulation,
    repo_analysis,
    terraform_manager,
)
from .auth import require_internal_token
from .backends import get_backend
from .cache_check import CacheCheckError
from .credentials import CredentialValidationError
from .db import get_db
from .models import (
    AnalyzeRepoRequest,
    CacheCheckRequest,
    ProvisionRequest,
    SimulateRebuildRequest,
    TeardownRequest,
    ValidateCredentialRequest,
)
from .rebuild_simulation import SimulationError
from .repo_analysis import AnalysisError
from .settings import settings

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


@app.get("/health")
def health():
    return {"status": "ok", "besPort": settings.bes_port}


@app.post("/credentials/validate", dependencies=[Depends(require_internal_token)])
def validate_credential(request: ValidateCredentialRequest):
    """Confirms an AWS role is actually assumable with the given bootstrap key before the backend
    encrypts and stores anything -- called from CloudCredentialsService.connect(), never exposed
    to the frontend directly (this route itself is internal-token gated, same as every other route
    here)."""
    try:
        assumed_role_arn = credentials.validate_assume_role(
            request.roleArn,
            request.externalId,
            request.bootstrapAccessKeyId,
            request.bootstrapSecretAccessKey,
            request.region,
        )
    except CredentialValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"assumedRoleArn": assumed_role_arn}


@app.post("/provision", dependencies=[Depends(require_internal_token)])
def provision(request: ProvisionRequest, db: Database = Depends(get_db)):
    backend = get_backend(request.provider)
    return backend.provision(request, db)


@app.post("/teardown", dependencies=[Depends(require_internal_token)])
def teardown(request: TeardownRequest, db: Database = Depends(get_db)):
    workspace_id = request.workspaceId
    existing = db.buildfarm_instances.find_one({"workspaceId": workspace_id})
    # No instance ever provisioned for this workspace -- nothing to tear down. Default to the
    # docker backend (its own teardown is already a no-op when nothing's on disk) rather than
    # erroring, matching the existing tolerant-of-already-gone behavior.
    provider = existing.get("provider", "docker") if existing else "docker"
    backend = get_backend(provider)
    return backend.teardown(workspace_id, db, aws_credential=request.awsCredential)


@app.get("/infra/{workspace_id}", dependencies=[Depends(require_internal_token)])
def infra(workspace_id: str, db: Database = Depends(get_db)):
    existing = db.buildfarm_instances.find_one(
        {"workspaceId": workspace_id}, {"_id": 0, "terraformState": 0, "terraformVars": 0}
    )
    if not existing:
        return {"containers": []}
    backend = get_backend(existing.get("provider", "docker"))
    return backend.infra(workspace_id, existing)


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

    backend = get_backend(existing.get("provider", "docker"))
    return backend.status(workspace_id, db, existing)


@app.get("/provision/{workspace_id}/log", dependencies=[Depends(require_internal_token)])
def provision_log(workspace_id: str, db: Database = Depends(get_db)):
    """Tails the current AWS apply/destroy's live Terraform output -- polled concurrently while a
    /provision or /teardown call for the same workspace is still in flight (see
    terraform_manager.read_log_tail's docstring for why that's safe). Empty for Docker workspaces
    or before any AWS operation has run yet."""
    existing = db.buildfarm_instances.find_one({"workspaceId": workspace_id}, {"_id": 0, "provider": 1})
    if not existing or existing.get("provider") != "aws":
        return {"log": ""}
    return {"log": terraform_manager.read_log_tail(terraform_manager.workspace_dir(workspace_id))}


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


@app.get("/simulate-rebuild/{workspace_id}/log", dependencies=[Depends(require_internal_token)])
def simulate_rebuild_log(workspace_id: str):
    return {"log": rebuild_simulation.read_log_tail(workspace_id)}


@app.post("/simulate-rebuild", dependencies=[Depends(require_internal_token)])
def simulate_rebuild(request: SimulateRebuildRequest):
    try:
        return rebuild_simulation.run_simulation(
            request.workspaceId,
            request.repoUrl,
            request.token,
            request.branch,
            request.target,
            request.filePath,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SimulationError as e:
        raise HTTPException(status_code=502, detail={"message": str(e), "logTail": e.log_tail})


@app.get("/cache-check/{workspace_id}/log", dependencies=[Depends(require_internal_token)])
def cache_check_log(workspace_id: str):
    return {"log": cache_check.read_log_tail(workspace_id)}


@app.post("/cache-check", dependencies=[Depends(require_internal_token)])
def cache_check_endpoint(request: CacheCheckRequest):
    try:
        return cache_check.run_cache_check(
            request.workspaceId,
            request.repoUrl,
            request.token,
            request.branch,
            request.target,
            request.grpcPort,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except CacheCheckError as e:
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
