import type { BuildfarmProvider } from "./buildfarm-config.js";

export type BuildfarmInstanceStatus =
  | "provisioning"
  | "running"
  | "error"
  | "stopped";

export interface BuildfarmInstancePorts {
  /** Buildfarm SHARD server port: serves remote execution, remote cache, and ByteStream on one port. */
  grpc: number;
}

/** The OS/CPU the worker container runs, in Bazel constraint vocabulary. A project's execution
 * platform has to match this, or tools built for the developer's own OS fail with "Exec format
 * error" when Bazel dispatches them to the worker. */
export interface WorkerPlatform {
  os: string;
  cpu: "aarch64" | "x86_64";
}

/** Copy-ready configuration for pointing an existing Bazel project at a workspace's Buildfarm. */
export interface ConnectConfig {
  bazelrc: string;
  platformsBuild: string | null;
  platform: WorkerPlatform | null;
}

/** Real AWS resource ids, read from Terraform's own outputs once a workspace's AWS topology is
 * actually provisioned -- distinct from the Designer's architecture diagram knowing the *shape*
 * (always derivable from BuildfarmConfig) vs. this supplying the real *ids* to overlay onto it.
 * Absent on BuildfarmInstance = never provisioned; `{}` = torn down (AwsBackend.teardown() clears
 * it this way, mirroring awsResourceIds' own []-clears convention) -- callers should treat
 * `!awsTopology?.vpcId` as "nothing live to show" rather than checking for the field's presence. */
export interface AwsTopology {
  vpcId: string;
  vpcCidr: string;
  publicSubnetId: string;
  publicSubnetCidr: string;
  privateSubnetId: string;
  privateSubnetCidr: string;
  internetGatewayId: string;
  natGatewayId: string;
  natGatewayPublicIp: string;
  serverSecurityGroupId: string;
  internalSecurityGroupId: string;
  serverInstanceId: string;
  workerLaunchTemplateId: string;
  workerAsgName: string;
  redisEndpoint: string;
  cacheInstanceId: string | null;
  cacheInstancePrivateIp: string | null;
  cacheBucketName: string | null;
  cacheIamRoleArn: string | null;
  /** Phase 0 (Multi-AZ HA): Server's Network Load Balancer DNS name -- the same value as
   * BuildfarmInstance.host now, surfaced here too so the architecture diagram can show the NLB as
   * its own node. */
  loadBalancerDnsName: string;
  /** Phase 0: Redis is now an ElastiCache Multi-AZ replication group with automatic failover,
   * not a single-node cluster. */
  redisReplicationGroupId: string;
}

export type CiProvider = "github" | "gitlab" | "jenkins";

/** One file to add to the user's repository. */
export interface ConnectKitFile {
  path: string;
  description: string;
  content: string;
}

/** Everything needed to connect an existing repo's CI to a workspace's Buildfarm. */
export interface ConnectKit {
  host: string;
  provider: CiProvider;
  files: ConnectKitFile[];
  warnings: string[];
  /** Local command that proves the connection (also streams to the dashboard). */
  verifyCommand: string;
}

export interface BuildfarmInstance {
  workspaceId: string;
  provider: BuildfarmProvider;
  /** Docker-only. Kept as an optional field rather than deleted -- it's still exactly what the
   * Docker backend's teardown-by-project-name needs, and generalizing would force a parallel
   * field for no benefit. Undefined for "aws" instances. */
  composeProjectName?: string;
  ports: BuildfarmInstancePorts;
  /** Docker-only: container ids to tear down by. Undefined for "aws" instances (see
   * awsResourceIds). Kept separate from awsResourceIds rather than overloading one field with two
   * different id shapes across providers. */
  containerIds?: string[];
  /** AWS-only: EC2 instance ids + the security group id, as returned by `terraform show -json`.
   * Undefined for "docker" instances. */
  awsResourceIds?: string[];
  /** AWS-only: the full real resource topology once provisioned -- see AwsTopology's own doc
   * comment for the absent/`{}` distinction. Undefined for "docker" instances. */
  awsTopology?: AwsTopology;
  /** Externally reachable address for the Buildfarm's gRPC endpoint -- the EC2 instance's public
   * IP/DNS for "aws", or null for "docker" (callers fall back to "localhost", exactly today's
   * behavior). Was implicit/hardcoded everywhere as "localhost" before this field existed. */
  host: string | null;
  status: BuildfarmInstanceStatus;
  lastError: string | null;
  platform?: WorkerPlatform;
  updatedAt: string;
}
