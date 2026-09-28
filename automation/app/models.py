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
    # Defaulted so any caller not yet updated -- including the existing test suite -- keeps
    # working unchanged. TeardownRequest/status/infra don't carry this: the provider is read back
    # from the buildfarm_instances document written at provision time instead, so a caller never
    # has to remember which provider a workspace used.
    provider: Literal["docker", "aws"] = "docker"
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


class CacheCheckRequest(BaseModel):
    workspaceId: str
    repoUrl: str
    token: str
    branch: str
    target: str
    grpcPort: int


class ValidateCredentialRequest(BaseModel):
    roleArn: str
    externalId: str
    bootstrapAccessKeyId: str
    bootstrapSecretAccessKey: str
    region: str
