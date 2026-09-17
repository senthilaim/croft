export type BuildfarmNodeType = "server" | "worker" | "redis" | "cache";

export interface BuildfarmNodePosition {
  x: number;
  y: number;
}

export interface ServerNodeConfig {
  cpuLimit: string; // e.g. "1", "0.5"
  memoryLimitMb: number;
}

export interface WorkerNodeConfig {
  replicas: number;
  cpuLimit: string;
  memoryLimitMb: number;
  /** When false, this worker stores CAS blobs (enabling remote caching) but refuses execution
   * dispatches -- "cache-only" mode. Buildfarm's server has no storage of its own, so a Worker
   * is always required even when you only want a shared remote cache, not remote execution. */
  executionEnabled: boolean;
}

export interface RedisNodeConfig {
  memoryLimitMb: number;
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
  nodes: BuildfarmNode[];
  edges: BuildfarmEdge[];
  status: BuildfarmConfigStatus;
  updatedAt: string;
}

export interface SaveBuildfarmConfigRequest {
  nodes: BuildfarmNode[];
  edges: BuildfarmEdge[];
}
