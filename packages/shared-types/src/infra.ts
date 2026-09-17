export type ContainerRole = "server" | "worker" | "redis" | "unknown";

export interface ContainerStats {
  id: string;
  name: string;
  role: ContainerRole;
  cpuPercent: number;
  memUsageMb: number;
  memLimitMb: number;
  memPercent: number;
}

export interface InfraStats {
  containers: ContainerStats[];
}
