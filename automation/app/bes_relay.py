import logging

import requests

from .settings import settings

log = logging.getLogger("bes_relay")


def post_event(workspace_id: str, event: dict) -> None:
    """Forwards one parsed BEP event to the backend's incremental build ingestion endpoint.

    Reuses the same Node.js ingestion logic that the (now-removed) file-based wrapper used --
    this service only has to decode the gRPC-streamed event into the equivalent JSON shape.
    """
    url = f"{settings.backend_url}/workspaces/{workspace_id}/builds/ingest-event"
    try:
        requests.post(url, json=event, timeout=5)
    except Exception:
        log.exception("failed to relay BES event for workspace %s", workspace_id)
