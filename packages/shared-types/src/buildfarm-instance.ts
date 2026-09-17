export type BuildfarmInstanceStatus =
  | "provisioning"
  | "running"
  | "error"
  | "stopped";

export interface BuildfarmInstancePorts {
  /** Buildfarm SHARD server port: serves remote execution, remote cache, and ByteStream on one port. */
  grpc: number;
}

export interface BuildfarmInstance {
  workspaceId: string;
  composeProjectName: string;
  ports: BuildfarmInstancePorts;
  containerIds: string[];
  status: BuildfarmInstanceStatus;
  lastError: string | null;
  updatedAt: string;
}
