import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BuildfarmNodeConfig, BuildfarmNodeType } from "@bazel-bootstrap/shared-types";
import { NODE_LABELS } from "./node-defaults";

export interface BuildfarmNodeData {
  nodeType: BuildfarmNodeType;
  config: BuildfarmNodeConfig;
  [key: string]: unknown;
}

const ACCENT: Record<BuildfarmNodeType, string> = {
  server: "border-blue-500",
  worker: "border-emerald-500",
  redis: "border-red-500",
  cache: "border-amber-500",
};

function summarize(data: BuildfarmNodeData): string {
  const { nodeType, config } = data;
  switch (nodeType) {
    case "server": {
      const c = config as { cpuLimit: string; memoryLimitMb: number };
      return `${c.cpuLimit} CPU · ${c.memoryLimitMb} MB`;
    }
    case "worker": {
      const c = config as {
        replicas: number;
        cpuLimit: string;
        memoryLimitMb: number;
        executionEnabled?: boolean;
      };
      const mode = c.executionEnabled === false ? "cache only" : `${c.replicas}×`;
      return `${mode} · ${c.cpuLimit} CPU · ${c.memoryLimitMb} MB`;
    }
    case "redis": {
      const c = config as { memoryLimitMb: number };
      return `${c.memoryLimitMb} MB`;
    }
    case "cache": {
      const c = config as { sizeGb: number };
      return `${c.sizeGb} GB`;
    }
  }
}

export function BuildfarmNodeView({ data, selected }: NodeProps) {
  const nodeData = data as unknown as BuildfarmNodeData;
  return (
    <div
      className={`min-w-[160px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm dark:bg-zinc-900 ${
        ACCENT[nodeData.nodeType]
      } ${selected ? "ring-2 ring-offset-1 ring-black/30 dark:ring-white/30" : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {NODE_LABELS[nodeData.nodeType]}
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{summarize(nodeData)}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = {
  server: BuildfarmNodeView,
  worker: BuildfarmNodeView,
  redis: BuildfarmNodeView,
  cache: BuildfarmNodeView,
};
