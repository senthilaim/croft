from typing import Literal

from pydantic import BaseModel

BuildfarmNodeType = Literal["server", "worker", "redis", "cache"]


class NodePosition(BaseModel):
    x: float
    y: float


class BuildfarmNode(BaseModel):
    id: str
    type: BuildfarmNodeType
    position: NodePosition
    config: dict


class BuildfarmEdge(BaseModel):
    id: str
    source: str
    target: str


class ProvisionRequest(BaseModel):
    workspaceId: str
    nodes: list[BuildfarmNode]
    edges: list[BuildfarmEdge]


class TeardownRequest(BaseModel):
    workspaceId: str


class AnalyzeRepoRequest(BaseModel):
    workspaceId: str
    repoUrl: str
    token: str
    branch: str


class SimulateRebuildRequest(BaseModel):
    workspaceId: str
    repoUrl: str
    token: str
    branch: str
    target: str
    filePath: str
