"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import type {
  BuildfarmConfig,
  BuildfarmEdge,
  BuildfarmInstance,
  BuildfarmNode,
  BuildfarmNodeType,
} from "@croft/shared-types";
import { nodeTypes, type BuildfarmNodeData } from "./buildfarm-node";
import { Palette, DRAG_DATA_TYPE } from "./palette";
import { ConfigPanel } from "./config-panel";
import { defaultConfigFor } from "./node-defaults";
import { validateTopology } from "./validate-topology";

function toFlowNode(n: BuildfarmNode): Node<BuildfarmNodeData> {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: { nodeType: n.type, config: n.config },
  };
}

function toFlowEdge(e: BuildfarmEdge): Edge {
  return { id: e.id, source: e.source, target: e.target };
}

function toBuildfarmNodes(nodes: Node<BuildfarmNodeData>[]): BuildfarmNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.data.nodeType,
    position: n.position,
    config: n.data.config,
  }));
}

function toBuildfarmEdges(edges: Edge[]): BuildfarmEdge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

type Preset = "full-rbe" | "cache-only";

function presetTopology(preset: Preset): { nodes: Node<BuildfarmNodeData>[]; edges: Edge[] } {
  const serverId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  const redisId = crypto.randomUUID();

  const server: Node<BuildfarmNodeData> = {
    id: serverId,
    type: "server",
    position: { x: 100, y: 80 },
    data: { nodeType: "server", config: defaultConfigFor("server") },
  };
  // A Worker is required either way -- Buildfarm's server has no storage of its own, so even
  // "cache-only" needs a worker to hold the shared cache. The difference is executionEnabled.
  const workerConfig = defaultConfigFor("worker");
  const worker: Node<BuildfarmNodeData> = {
    id: workerId,
    type: "worker",
    position: { x: 380, y: 80 },
    data: {
      nodeType: "worker",
      config: { ...workerConfig, executionEnabled: preset === "full-rbe" },
    },
  };
  const redis: Node<BuildfarmNodeData> = {
    id: redisId,
    type: "redis",
    position: { x: 240, y: 280 },
    data: { nodeType: "redis", config: defaultConfigFor("redis") },
  };

  return {
    nodes: [server, worker, redis],
    edges: [
      { id: crypto.randomUUID(), source: serverId, target: workerId },
      { id: crypto.randomUUID(), source: serverId, target: redisId },
    ],
  };
}

interface BuildfarmCanvasProps {
  workspaceId: string;
  initialConfig: BuildfarmConfig;
  initialInstance: BuildfarmInstance | null;
}

function CanvasInner({ workspaceId, initialConfig, initialInstance }: BuildfarmCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BuildfarmNodeData>>(
    initialConfig.nodes.map(toFlowNode),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialConfig.edges.map(toFlowEdge),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [instance, setInstance] = useState<BuildfarmInstance | null>(initialInstance);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tearingDown, setTearingDown] = useState(false);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds: Edge[]) => addEdge({ ...connection, id: crypto.randomUUID() }, eds));
    },
    [setEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData(DRAG_DATA_TYPE) as BuildfarmNodeType | "";
      if (!nodeType) return;

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = crypto.randomUUID();
      const newNode: Node<BuildfarmNodeData> = {
        id,
        type: nodeType,
        position,
        data: { nodeType, config: defaultConfigFor(nodeType) },
      };
      setNodes((nds: Node<BuildfarmNodeData>[]) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes],
  );

  const applyPreset = useCallback(
    (preset: Preset) => {
      const { nodes: presetNodes, edges: presetEdges } = presetTopology(preset);
      setNodes(presetNodes);
      setEdges(presetEdges);
    },
    [setNodes, setEdges],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const updateSelectedConfig = useCallback(
    (config: BuildfarmNodeData["config"]) => {
      if (!selectedNodeId) return;
      setNodes((nds: Node<BuildfarmNodeData>[]) =>
        nds.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...n.data, config } } : n)),
      );
    },
    [selectedNodeId, setNodes],
  );

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds: Node<BuildfarmNodeData>[]) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds: Edge[]) =>
      eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
    );
    setSelectedNodeId(null);
  }, [selectedNodeId, setNodes, setEdges]);

  const buildfarmNodes = useMemo(() => toBuildfarmNodes(nodes), [nodes]);
  const buildfarmEdges = useMemo(() => toBuildfarmEdges(edges), [edges]);
  const issues = useMemo(
    () => validateTopology(buildfarmNodes, buildfarmEdges),
    [buildfarmNodes, buildfarmEdges],
  );

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/buildfarm-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: buildfarmNodes, edges: buildfarmEdges }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveMessage(data.message ?? "Failed to save");
        return;
      }
      setSaveMessage("Saved");
    } catch {
      setSaveMessage("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitSetup() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const saveRes = await fetch(`/api/workspaces/${workspaceId}/buildfarm-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: buildfarmNodes, edges: buildfarmEdges }),
      });
      if (!saveRes.ok) {
        setSubmitError("Could not save configuration before submitting");
        return;
      }

      const res = await fetch(`/api/workspaces/${workspaceId}/buildfarm/submit`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data.message ?? data.issues?.join(", ") ?? "Failed to submit setup");
        if (data.instance) setInstance(data.instance);
        return;
      }
      setInstance(data as BuildfarmInstance);
    } catch {
      setSubmitError("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTeardown() {
    setTearingDown(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/buildfarm/teardown`, {
        method: "POST",
      });
      if (res.ok) setInstance((await res.json()) as BuildfarmInstance);
    } finally {
      setTearingDown(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <Palette />
      <div className="relative flex-1" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_: React.MouseEvent, node: Node<BuildfarmNodeData>) =>
            setSelectedNodeId(node.id)
          }
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
        >
          <Background />
          <Controls />
          <Panel position="top-right" className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium shadow transition-colors hover:bg-black/[.03] disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/[.05]"
              >
                {saving ? "Saving…" : "Save configuration"}
              </button>
              {instance?.status === "running" ? (
                <button
                  onClick={handleTeardown}
                  disabled={tearingDown}
                  className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {tearingDown ? "Tearing down…" : "Teardown"}
                </button>
              ) : (
                <button
                  onClick={handleSubmitSetup}
                  disabled={submitting || issues.length > 0}
                  className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-brand-hover disabled:opacity-50"
                >
                  {submitting ? "Setting up…" : "Submit Setup"}
                </button>
              )}
            </div>

            {saveMessage && (
              <span className="rounded bg-white/90 px-2 py-1 text-xs text-zinc-700 shadow dark:bg-zinc-900/90 dark:text-zinc-300">
                {saveMessage}
              </span>
            )}

            {submitError && (
              <span className="max-w-xs rounded bg-red-50 px-2 py-1 text-xs text-red-700 shadow dark:bg-red-950 dark:text-red-300">
                {submitError}
              </span>
            )}

            {instance && (
              <div className="rounded bg-white/90 px-3 py-2 text-xs shadow dark:bg-zinc-900/90">
                <p className="font-medium text-zinc-800 dark:text-zinc-200">
                  Status:{" "}
                  <span
                    className={
                      instance.status === "running"
                        ? "text-green-600 dark:text-green-400"
                        : instance.status === "error"
                          ? "text-red-600 dark:text-red-400"
                          : "text-amber-600 dark:text-amber-400"
                    }
                  >
                    {instance.status}
                  </span>
                </p>
                {instance.status === "running" && (
                  <>
                    <p className="text-zinc-500 dark:text-zinc-400">
                      grpc://localhost:{instance.ports.grpc}
                    </p>
                    <Link
                      href={`/workspaces/${workspaceId}/sample-project`}
                      className="text-blue-600 underline dark:text-blue-400"
                    >
                      Get sample project →
                    </Link>
                  </>
                )}
              </div>
            )}

            {issues.length > 0 && (
              <div className="max-w-xs rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow dark:bg-amber-950 dark:text-amber-300">
                <p className="font-medium">Before you can submit setup:</p>
                <ul className="list-disc pl-4">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </ReactFlow>

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border border-black/10 bg-white/95 p-6 text-center shadow-lg dark:border-white/10 dark:bg-zinc-900/95">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Start from a preset, or drag components from the left
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => applyPreset("full-rbe")}
                  className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
                >
                  Full RBE
                </button>
                <button
                  onClick={() => applyPreset("cache-only")}
                  className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/[.06]"
                >
                  Cache only
                </button>
              </div>
              <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
                Both provision Server, Worker, and Redis. <strong>Full RBE</strong> executes
                builds on the Worker. <strong>Cache only</strong> builds run on your own machine,
                sharing results through the Worker&apos;s remote cache instead.
              </p>
            </div>
          </div>
        )}
      </div>
      {selectedNode && (
        <ConfigPanel
          nodeId={selectedNode.id}
          nodeType={selectedNode.data.nodeType}
          config={selectedNode.data.config}
          onChange={updateSelectedConfig}
          onDelete={deleteSelectedNode}
        />
      )}
    </div>
  );
}

export function BuildfarmCanvas(props: BuildfarmCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
