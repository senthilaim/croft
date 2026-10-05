export type BuildfarmNodeType = "server" | "worker" | "redis" | "cache";

/** Staging-only allowlist for a node's config.instanceType when the design's provider is "aws" --
 * the smallest 1-2 entries per family from backend/src/cost/cost-estimator.ts's AWS catalog,
 * matching this release's staging posture. Shared so the designer UI's dropdown and the backend's
 * server-side enforcement (buildfarm-config/aws-instance-types.ts) can never drift apart. */
export const AWS_STAGING_INSTANCE_TYPES = ["m6i.large", "c6i.large"] as const;
export type AwsStagingInstanceType = (typeof AWS_STAGING_INSTANCE_TYPES)[number];

/** Provider is a whole-design choice, not per-node -- a Buildfarm's nodes must reach each other
 * directly (the backplane, CAS traffic), so mixing e.g. a Docker-local Server with an AWS Worker
 * isn't a coherent network without cross-provider VPN/peering, which is out of scope. */
export type BuildfarmProvider = "docker" | "aws";

export interface BuildfarmNodePosition {
  x: number;
  y: number;
}

export interface ServerNodeConfig {
  cpuLimit: string; // e.g. "1", "0.5"
  memoryLimitMb: number;
  /** Only meaningful when the design's provider is "aws" -- an instance type from the allowlisted
   * catalog (backend/src/cost/cost-estimator.ts). Undefined for Docker designs. */
  instanceType?: string;
}

export interface WorkerNodeConfig {
  /** Docker: the literal container count. AWS: the Auto Scaling Group's *desired* capacity. */
  replicas: number;
  cpuLimit: string;
  memoryLimitMb: number;
  /** When false, this worker stores CAS blobs (enabling remote caching) but refuses execution
   * dispatches -- "cache-only" mode. Buildfarm's server has no storage of its own, so a Worker
   * is always required even when you only want a shared remote cache, not remote execution. */
  executionEnabled: boolean;
  /** Only meaningful when the design's provider is "aws". Undefined for Docker designs. */
  instanceType?: string;
  /** AWS-only ASG bounds. Both optional; absent means min=max=desired=replicas, i.e. today's
   * fixed-size behavior is the zero-config default -- nobody is forced into autoscaling. */
  minReplicas?: number;
  maxReplicas?: number;
}

export interface RedisNodeConfig {
  memoryLimitMb: number;
  /** Only meaningful when the design's provider is "aws". Undefined for Docker designs. */
  instanceType?: string;
}

/** The two Bazel remote-cache tiers Croft can wire into a Buildfarm worker's own `storages:`
 * chain: a FILESYSTEM entry (L1, "local") and -- optionally -- a GRPC entry pointing at a new
 * bazel-remote service (L2, "remote"), itself backed by local disk and/or S3. See the plan's
 * "Buildfarm's own storages: list is a documented chain" reasoning. */
export const REMOTE_CACHE_TIERS = ["local", "s3", "both"] as const;
export type RemoteCacheTier = (typeof REMOTE_CACHE_TIERS)[number];

export interface CacheNodeConfig {
  /** L1 size -- the Worker's own FILESYSTEM storage, always on. Also reused as bazel-remote's own
   * local-disk size when remoteCacheTier includes "local" (not split into two fields this release). */
  sizeGb: number;
  /** Undefined = no L2 at all (today's behavior, no bazel-remote service created). "s3"/"both"
   * are only meaningful when the design's provider is "aws" -- enforced server-side the same way
   * Worker/Server/Redis's instanceType already is. */
  remoteCacheTier?: RemoteCacheTier;
  /** The dedicated AWS cache instance's type. Only meaningful when provider is "aws" and
   * remoteCacheTier is set to any tier ("local" included) -- even without S3, a shared bazel-remote
   * instance gives the Worker ASG a warm, shared L2 cache instead of each new worker starting with
   * a cold local disk; S3 ("s3"/"both") additionally makes that shared cache durable. */
  instanceType?: string;
}

export type BuildfarmNodeConfig =
  | ServerNodeConfig
  | WorkerNodeConfig
  | RedisNodeConfig
  | CacheNodeConfig;

export interface BuildfarmNode {
  id: string;
  type: BuildfarmNodeType;
  position: BuildfarmNodePosition;
  config: BuildfarmNodeConfig;
}

export interface BuildfarmEdge {
  id: string;
  source: string;
  target: string;
}

export type BuildfarmConfigStatus =
  | "draft"
  | "provisioning"
  | "running"
  | "error"
  | "stopped";

export interface BuildfarmConfig {
  id: string;
  workspaceId: string;
  provider: BuildfarmProvider;
  nodes: BuildfarmNode[];
  edges: BuildfarmEdge[];
  status: BuildfarmConfigStatus;
  updatedAt: string;
}

export interface SaveBuildfarmConfigRequest {
  provider?: BuildfarmProvider; // omitted -> "docker", matching every design saved before this field existed
  nodes: BuildfarmNode[];
  edges: BuildfarmEdge[];
}
