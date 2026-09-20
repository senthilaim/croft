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

export interface BuildfarmInstance {
  workspaceId: string;
  composeProjectName: string;
  ports: BuildfarmInstancePorts;
  containerIds: string[];
  status: BuildfarmInstanceStatus;
  lastError: string | null;
  platform?: WorkerPlatform;
  updatedAt: string;
}
