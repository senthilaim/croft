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


class AwsCredential(BaseModel):
    """Forwarded by NestJS's ProvisioningService on every AWS provision/teardown call -- automation
    never touches the cloud_credentials collection directly, and never persists this secret itself
    (only the STS session credentials it derives from it, which are process-env-only and expire in
    an hour). See CloudCredentialsService.connect() for where the secret is decrypted."""

    roleArn: str
    externalId: str
    bootstrapAccessKeyId: str
    bootstrapSecretAccessKey: str
    region: str
    allowedIngressCidrs: list[str]


class ProvisionRequest(BaseModel):
    workspaceId: str
    # Defaulted so any caller not yet updated -- including the existing test suite -- keeps
    # working unchanged. status/infra don't carry this: the provider is read back from the
    # buildfarm_instances document written at provision time instead, so a caller never has to
    # remember which provider a workspace used.
    provider: Literal["docker", "aws"] = "docker"
    nodes: list[BuildfarmNode]
    edges: list[BuildfarmEdge]
    # Required when provider == "aws" (AwsBackend.provision() raises 400 if missing); unused/None
    # for Docker.
    awsCredential: AwsCredential | None = None


class TeardownRequest(BaseModel):
    workspaceId: str
    # Same as ProvisionRequest.awsCredential -- AwsBackend.teardown() needs a fresh STS session too
    # (to run `terraform destroy`), and nothing durably stores this secret on the automation side
    # for it to reuse from provision time.
    awsCredential: AwsCredential | None = None


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
