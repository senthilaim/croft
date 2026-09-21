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
  composeProjectName: string;
  ports: BuildfarmInstancePorts;
  containerIds: string[];
  status: BuildfarmInstanceStatus;
  lastError: string | null;
  platform?: WorkerPlatform;
  updatedAt: string;
}
