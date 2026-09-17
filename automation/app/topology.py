from dataclasses import dataclass

from .models import BuildfarmNode


class InvalidTopologyError(Exception):
    def __init__(self, issues: list[str]):
        super().__init__("; ".join(issues))
        self.issues = issues


@dataclass
class Topology:
    server: BuildfarmNode
    workers: list[BuildfarmNode]
    redis: BuildfarmNode
    cache: BuildfarmNode | None

    @property
    def worker(self) -> BuildfarmNode:
        return self.workers[0]


def parse_topology(nodes: list[BuildfarmNode]) -> Topology:
    servers = [n for n in nodes if n.type == "server"]
    workers = [n for n in nodes if n.type == "worker"]
    redises = [n for n in nodes if n.type == "redis"]
    caches = [n for n in nodes if n.type == "cache"]

    issues = []
    if len(servers) != 1:
        issues.append("Topology must have exactly one Server node")
    if len(workers) != 1:
        issues.append("Topology must have exactly one Worker node (use its replicas field to scale)")
    # A Worker is always required -- Buildfarm's server delegates all CAS blob storage to
    # registered workers. For "cache-only", the Worker's executionEnabled config is set to
    # false instead of removing the node.
    if len(redises) != 1:
        issues.append("Topology must have exactly one Redis Backplane node")
    if len(caches) > 1:
        issues.append("Topology must have at most one Cache node")

    if issues:
        raise InvalidTopologyError(issues)

    return Topology(
        server=servers[0],
        workers=workers,
        redis=redises[0],
        cache=caches[0] if caches else None,
    )
