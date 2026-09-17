import type { BuildfarmNodeConfig, BuildfarmNodeType } from "@bazel-bootstrap/shared-types";

export const NODE_PALETTE: { type: BuildfarmNodeType; label: string; description: string }[] = [
  { type: "server", label: "Server", description: "Buildfarm execution server" },
  { type: "worker", label: "Worker", description: "Executes build actions" },
  { type: "redis", label: "Redis Backplane", description: "Action/operation state" },
  { type: "cache", label: "Cache", description: "Content-addressable storage" },
];

export const NODE_LABELS: Record<BuildfarmNodeType, string> = {
  server: "Server",
  worker: "Worker",
  redis: "Redis Backplane",
  cache: "Cache",
};

export function defaultConfigFor(type: BuildfarmNodeType): BuildfarmNodeConfig {
  switch (type) {
    case "server":
      return { cpuLimit: "1", memoryLimitMb: 512 };
    case "worker":
      return { replicas: 1, cpuLimit: "1", memoryLimitMb: 1024, executionEnabled: true };
    case "redis":
      return { memoryLimitMb: 256 };
    case "cache":
      return { sizeGb: 10 };
  }
}
