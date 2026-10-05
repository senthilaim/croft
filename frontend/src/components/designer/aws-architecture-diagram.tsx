"use client";

import { useMemo, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AwsTopology, BuildfarmConfig } from "@croft/shared-types";
import { deriveAwsArchitecture, type ArchResourceNode } from "./aws-architecture";

const ACCENT: Record<ArchResourceNode["kind"], string> = {
  vpc: "border-zinc-400",
  subnet: "border-zinc-400",
  igw: "border-sky-500",
  nat: "border-sky-500",
  nlb: "border-sky-500",
  "ec2-server": "border-blue-500",
  "asg-worker": "border-emerald-500",
  elasticache: "border-red-500",
  "ec2-cache": "border-amber-500",
  s3: "border-purple-500",
};

// Every node gets a source+target handle on all 4 sides (hidden) so edges can be routed through
// whichever side is geometrically closest for this diagram's fixed layout -- see HANDLE_SIDE below,
// which picks the right one per edge rather than always defaulting to Top/Bottom.
function AllSidesHandles() {
  return (
    <>
      <Handle type="target" id="top" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" id="top" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" id="bottom" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" id="left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" id="left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" id="right" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="source" id="right" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
}

/** vpc/subnet render as a labelled, transparent group box (React Flow's parentId/extent nesting
 * draws their children inside). Everything else renders as a small resource card. */
function ArchNodeView({ data }: { data: ArchResourceNode & { onSelect: () => void } }) {
  const isGroup = data.kind === "vpc" || data.kind === "subnet";
  const live = Boolean(data.liveId);

  if (isGroup) {
    return (
      <div className="relative h-full w-full rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50/40 p-2 dark:border-zinc-700 dark:bg-zinc-900/20">
        <AllSidesHandles />
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {data.label}
          {data.detail ? <span className="ml-1 font-normal text-zinc-400">({data.detail})</span> : null}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={data.onSelect}
      className={`relative min-w-[150px] rounded-lg border-2 bg-white px-3 py-2 text-left shadow-sm dark:bg-zinc-900 ${ACCENT[data.kind]} ${
        live ? "" : "opacity-60"
      }`}
      style={{ borderStyle: live ? "solid" : "dashed" }}
    >
      <AllSidesHandles />
      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{data.label}</div>
      {data.detail && <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{data.detail}</div>}
      <div className="mt-1 text-[10px] font-medium">
        {live ? (
          <span className="text-green-600 dark:text-green-400">provisioned</span>
        ) : (
          <span className="text-zinc-400">design only</span>
        )}
      </div>
    </button>
  );
}

const nodeTypes = {
  vpc: ArchNodeView,
  subnet: ArchNodeView,
  igw: ArchNodeView,
  nat: ArchNodeView,
  nlb: ArchNodeView,
  "ec2-server": ArchNodeView,
  "asg-worker": ArchNodeView,
  elasticache: ArchNodeView,
  "ec2-cache": ArchNodeView,
  s3: ArchNodeView,
};

// Fixed, hand-positioned layout -- the shape has only a handful of deterministic variants (cache
// off / local / s3+both), never customer-arranged, so an auto-layout library is unneeded weight.
// Worker ASG and Redis sit side by side (not stacked) so the Worker-ASG -> Cache edge below them
// doesn't have to cross through Redis's box.
const LAYOUT: Record<string, { x: number; y: number; width?: number; height?: number }> = {
  vpc: { x: 0, y: 0, width: 820, height: 500 },
  "public-subnet": { x: 40, y: 60, width: 300, height: 400 },
  "private-subnet": { x: 380, y: 60, width: 420, height: 320 },
  igw: { x: 70, y: 30 },
  nat: { x: 70, y: 120 },
  nlb: { x: 70, y: 210 },
  server: { x: 70, y: 300 },
  "worker-asg": { x: 30, y: 30 },
  redis: { x: 250, y: 30 },
  cache: { x: 40, y: 230 },
  s3: { x: 860, y: 220 },
};

// Explicit per-edge handle sides, picked to match LAYOUT above -- a general "always Top/Bottom"
// default produced long diagonal lines cutting through unrelated boxes, since this diagram's nodes
// aren't vertically stacked in a single column.
const HANDLE_SIDE: Record<string, { source: string; target: string }> = {
  "e-nat-igw": { source: "top", target: "bottom" },
  "e-priv-nat": { source: "left", target: "right" },
  "e-nlb-server": { source: "bottom", target: "top" },
  "e-server-redis": { source: "right", target: "top" },
  "e-worker-redis": { source: "right", target: "left" },
  "e-worker-cache": { source: "bottom", target: "top" },
  "e-cache-s3": { source: "right", target: "left" },
};

function toFlowNodes(archNodes: ArchResourceNode[], onSelect: (n: ArchResourceNode) => void): Node[] {
  return archNodes.map((n) => {
    const layout = LAYOUT[n.id] ?? { x: 0, y: 0 };
    const isGroup = n.kind === "vpc" || n.kind === "subnet";
    return {
      id: n.id,
      type: n.kind,
      position: { x: layout.x, y: layout.y },
      parentId: n.parentId,
      extent: n.parentId ? ("parent" as const) : undefined,
      draggable: false,
      connectable: false,
      selectable: !isGroup,
      style: layout.width ? { width: layout.width, height: layout.height, zIndex: -1 } : undefined,
      data: { ...n, onSelect: () => onSelect(n) },
    };
  });
}

function toFlowEdges(archEdges: { id: string; source: string; target: string; label?: string }[]): Edge[] {
  return archEdges.map((e) => {
    const sides = HANDLE_SIDE[e.id];
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: sides?.source,
      targetHandle: sides?.target,
      label: e.label,
      type: "smoothstep",
      style: { stroke: "#a1a1aa" },
      labelStyle: { fontSize: 10, fill: "#71717a" },
      labelBgStyle: { fillOpacity: 0.85 },
    };
  });
}

interface Props {
  config: BuildfarmConfig;
  topology?: AwsTopology | null;
}

export function AwsArchitectureDiagram({ config, topology }: Props) {
  const architecture = useMemo(() => deriveAwsArchitecture(config, topology), [config, topology]);
  const [selected, setSelected] = useState<ArchResourceNode | null>(null);

  const nodes = useMemo(() => toFlowNodes(architecture.nodes, setSelected), [architecture.nodes]);
  const edges = useMemo(() => toFlowEdges(architecture.edges), [architecture.edges]);
  const isLive = Boolean(topology?.vpcId);

  return (
    <div className="relative h-full w-full">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          panOnScroll
          fitView
        >
          <Background />
        </ReactFlow>
      </ReactFlowProvider>

      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-4 rounded-lg bg-white/90 px-3 py-2 text-[11px] shadow dark:bg-zinc-900/90">
        <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
          <span className="inline-block h-2 w-5 rounded border-2 border-dashed border-zinc-400 opacity-60" />
          Design only -- not yet provisioned
        </span>
        <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
          <span className="inline-block h-2 w-5 rounded border-2 border-solid border-zinc-400" />
          Live -- real AWS resource
        </span>
      </div>

      {!isLive && (
        <div className="absolute right-3 top-3 max-w-xs rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow dark:bg-amber-950 dark:text-amber-300">
          This workspace hasn&apos;t been provisioned yet -- this diagram shows what your current
          design would create.
        </div>
      )}

      {selected && (
        <div className="absolute right-3 top-3 w-72 rounded-lg border border-black/10 bg-white p-3 text-xs shadow-lg dark:border-white/10 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">{selected.label}</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              Close
            </button>
          </div>
          {selected.detail && <p className="mb-2 text-zinc-500 dark:text-zinc-400">{selected.detail}</p>}
          {selected.liveId ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">Resource id</span>
                <CopyButton value={selected.liveId} />
              </div>
              <pre className="overflow-auto rounded bg-black/[.03] p-2 font-mono text-[11px] text-zinc-700 dark:bg-white/[.05] dark:text-zinc-300">
                {selected.liveId}
              </pre>
            </div>
          ) : (
            <p className="text-zinc-400">Not provisioned yet -- no real resource id.</p>
          )}
        </div>
      )}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs font-medium text-brand hover:underline"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
