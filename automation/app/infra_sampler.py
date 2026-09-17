"""Periodic sampler that persists container CPU/memory usage so it can be viewed as a trend over
time, not just live. GET /infra/{workspace_id} is a synchronous, no-history `docker stats` poll --
this fills that gap by writing timestamped snapshots to a new `infra_samples` collection, which
self-prunes via a Mongo TTL index rather than needing any manual cleanup job.
"""

import logging
import threading
import time
from datetime import datetime, timezone

from . import docker_manager
from .db import get_db

log = logging.getLogger("infra_sampler")

SAMPLE_INTERVAL_SECONDS = 60
RETENTION_SECONDS = 7 * 24 * 3600


def _ensure_ttl_index() -> None:
    get_db().infra_samples.create_index("sampledAt", expireAfterSeconds=RETENTION_SECONDS)


def _sample_once() -> None:
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    for instance in db.buildfarm_instances.find({"status": "running"}):
        container_ids = instance.get("containerIds") or []
        if not container_ids:
            continue
        stats = docker_manager.container_stats(container_ids)
        if not stats:
            continue
        db.infra_samples.insert_many(
            [
                {
                    "workspaceId": instance["workspaceId"],
                    "containerId": s["id"],
                    "name": s["name"],
                    "role": s["role"],
                    "cpuPercent": s["cpuPercent"],
                    "memUsageMb": s["memUsageMb"],
                    "memLimitMb": s["memLimitMb"],
                    "memPercent": s["memPercent"],
                    "sampledAt": now,
                }
                for s in stats
            ]
        )


def _loop() -> None:
    _ensure_ttl_index()
    while True:
        try:
            _sample_once()
        except Exception:
            log.exception("infra sampling tick failed")
        time.sleep(SAMPLE_INTERVAL_SECONDS)


def start_in_background() -> None:
    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
