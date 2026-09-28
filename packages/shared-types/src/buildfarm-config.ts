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
  replicas: number;
  cpuLimit: string;
  memoryLimitMb: number;
  /** When false, this worker stores CAS blobs (enabling remote caching) but refuses execution
   * dispatches -- "cache-only" mode. Buildfarm's server has no storage of its own, so a Worker
   * is always required even when you only want a shared remote cache, not remote execution. */
  executionEnabled: boolean;
  /** Only meaningful when the design's provider is "aws". Undefined for Docker designs. */
  instanceType?: string;
}

export interface RedisNodeConfig {
  memoryLimitMb: number;
  /** Only meaningful when the design's provider is "aws". Undefined for Docker designs. */
  instanceType?: string;
}

export interface CacheNodeConfig {
  sizeGb: number;
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
