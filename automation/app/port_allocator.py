from pymongo.database import Database

from .settings import settings


def _next_free(db: Database, busy: set[int]) -> int:
    highest = db.port_allocations.find_one(sort=[("port", -1)])
    port = (highest["port"] + 1) if highest else settings.port_range_start
    while port in busy:
        port += 1
    return port


def allocate_port(db: Database, workspace_id: str, busy: set[int] | None = None) -> int:
    """Return a stable host port for this workspace, allocating a new one on first use.
    `busy` is a set of host ports already published by other containers, which are skipped."""
    existing = db.port_allocations.find_one({"workspaceId": workspace_id})
    if existing:
        return existing["port"]

    port = _next_free(db, busy or set())
    db.port_allocations.insert_one({"workspaceId": workspace_id, "port": port})
    return port


def reallocate_port(db: Database, workspace_id: str, busy: set[int]) -> int:
    """Move a workspace to a new free port after its current one turned out to be taken."""
    current = db.port_allocations.find_one({"workspaceId": workspace_id})
    busy = set(busy) | ({current["port"]} if current else set())
    port = _next_free(db, busy)
    db.port_allocations.update_one({"workspaceId": workspace_id}, {"$set": {"port": port}}, upsert=True)
    return port
