from pymongo.database import Database

from .settings import settings


def allocate_port(db: Database, workspace_id: str) -> int:
    """Return a stable host port for this workspace, allocating a new one on first use."""
    existing = db.port_allocations.find_one({"workspaceId": workspace_id})
    if existing:
        return existing["port"]

    highest = db.port_allocations.find_one(sort=[("port", -1)])
    next_port = (highest["port"] + 1) if highest else settings.port_range_start

    db.port_allocations.insert_one({"workspaceId": workspace_id, "port": next_port})
    return next_port
