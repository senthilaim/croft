"""The seam between "what a Buildfarm design says" and "where it actually runs."

Until now this whole service only ever talked to the local Docker daemon, with no interface
anywhere -- main.py called render.py/docker_manager.py directly by name. ProvisioningBackend is
that interface, narrow on purpose: exactly the five things main.py's routes already do by direct
call, nothing speculative. DockerBackend (docker_backend.py) is a behavior-preserving move of the
existing logic; a second implementation (AWS) slots in beside it without main.py's routes needing
to know which one they're talking to.
"""

from datetime import datetime, timezone
from typing import Protocol

from pymongo.database import Database

from ..models import ProvisionRequest


class ProvisioningBackend(Protocol):
    def provision(self, request: ProvisionRequest, db: Database) -> dict: ...

    def teardown(self, workspace_id: str, db: Database) -> dict: ...

    def status(self, workspace_id: str, db: Database, existing: dict) -> dict: ...

    def infra(self, workspace_id: str, existing: dict) -> dict: ...


def save_instance(
    db: Database,
    workspace_id: str,
    *,
    provider: str,
    status: str,
    host: str | None = None,
    container_ids: list[str] | None = None,
    aws_resource_ids: list[str] | None = None,
    grpc_port: int | None = None,
    last_error: str | None = None,
    platform: dict | None = None,
    compose_project_name: str | None = None,
) -> dict:
    """Writes a `buildfarm_instances` document in the shape backend/src ...
    packages/shared-types/src/buildfarm-instance.ts describes -- shared by every backend, not
    Docker-specific, unlike the old main.py version this replaces (which always wrote
    composeProjectName/containerIds regardless of provider). `host` is left unset (-> None/null)
    for Docker, matching the shared type's "null for Docker, callers fall back to localhost"
    contract -- never write the string "localhost" here, the frontend/backend own that fallback.
    """
    doc: dict = {
        "workspaceId": workspace_id,
        "provider": provider,
        "status": status,
        "lastError": last_error,
        "host": host,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    if compose_project_name is not None:
        doc["composeProjectName"] = compose_project_name
    if container_ids is not None:
        doc["containerIds"] = container_ids
    if aws_resource_ids is not None:
        doc["awsResourceIds"] = aws_resource_ids
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


def get_backend(provider: str) -> ProvisioningBackend:
    # Imported lazily (not at module top) so importing this package doesn't require every
    # backend's own dependencies (e.g. AwsBackend's boto3) to be installed just to provision
    # Docker -- matches the optional-integration spirit already used for Stripe/OIDC elsewhere in
    # this app, applied here to a Python service instead of NestJS.
    from .docker_backend import DockerBackend

    backends: dict[str, ProvisioningBackend] = {"docker": DockerBackend()}
    if provider not in backends:
        raise ValueError(f"Unknown or unsupported provisioning provider: {provider!r}")
    return backends[provider]
