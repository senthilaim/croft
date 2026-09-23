"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RepoAnalysisResult, RepoConnection } from "@croft/shared-types";
import { layoutPackageGraph } from "@/lib/package-graph-layout";

const field =
  "h-9 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100";
const card =
  "rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className={`${card} p-5`}>
      <h2 className="mb-3 flex items-center gap-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs text-white">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function LogPanel({ text, failed }: { text: string | null; failed: boolean }) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div
      className={`mt-3 overflow-hidden rounded-lg border ${
        failed ? "border-red-200 dark:border-red-900/40" : "border-black/10 dark:border-white/10"
      }`}
    >
      <div
        className={`flex items-center justify-between border-b px-3 py-1.5 text-xs font-medium ${
          failed
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300"
            : "border-black/10 bg-black/[.03] text-zinc-600 dark:border-white/10 dark:bg-white/[.04] dark:text-zinc-300"
        }`}
      >
        {failed ? "Sandbox log (why it failed)" : "Sandbox log — live"}
      </div>
      <pre
        ref={ref}
        className="max-h-56 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-zinc-700 dark:text-zinc-300"
      >
        {text || "Waiting for output…"}
      </pre>
    </div>
  );
}

interface GraphNodeData {
  label: string;
  targetCount: number;
  external: boolean;
}

function GraphNode({ data: rawData }: NodeProps) {
  const data = rawData as unknown as GraphNodeData;
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs shadow-sm ${
        data.external
          ? "border-dashed border-zinc-400 bg-black/[.03] text-zinc-600 dark:border-zinc-600 dark:bg-white/[.05] dark:text-zinc-300"
          : "border-brand/40 bg-brand-soft text-zinc-900 dark:text-zinc-50"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-400" />
      <p className="max-w-[180px] truncate font-mono" title={data.label}>
        {data.label}
      </p>
      {!data.external && <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{data.targetCount} targets</p>}
      <Handle type="source" position={Position.Right} className="!bg-zinc-400" />
    </div>
  );
}
const nodeTypes = { pkg: GraphNode };

function PackageGraphView({ analysis }: { analysis: RepoAnalysisResult }) {
  const { nodes, edges } = useMemo(() => {
    const laidOut = layoutPackageGraph(analysis.packageGraph);
    const nodes = laidOut.map((n) => ({
      id: n.id,
      type: "pkg",
      position: { x: n.x, y: n.y },
      data: { label: n.id, targetCount: n.targetCount, external: n.external },
    }));
    const edges = analysis.packageGraph.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.source,
      target: e.target,
      style: { stroke: "var(--chart-axis)" },
    }));
    return { nodes, edges };
  }, [analysis.packageGraph]);

  if (nodes.length === 0) {
    return (
      <p className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        No package dependencies found.
      </p>
    );
  }

  return (
    <div className="h-[480px]">
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
          <Background />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

export function RepoAnalyzer({
  workspaceId,
  initialConnection,
  initialAnalysis,
}: {
  workspaceId: string;
  initialConnection: RepoConnection | null;
  initialAnalysis: RepoAnalysisResult | null;
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [connected, setConnected] = useState(false);

  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!connection) return;
    const socket: Socket = io({ path: "/ws", addTrailingSlash: false, transports: ["websocket"] });
    socket.on("connect", () =>
      socket.emit("subscribe", { workspaceId }, (ack?: { ok: boolean }) => setConnected(!!ack?.ok)),
    );
    socket.on("disconnect", () => setConnected(false));
    socket.on("repoAnalysis", (next: RepoAnalysisResult) => setAnalysis(next));
    return () => {
      socket.emit("unsubscribe", { workspaceId });
      socket.disconnect();
    };
  }, [workspaceId, connection]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/repo-analysis/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, token }),
      });
      const body = await res.json();
      if (!res.ok) {
        setConnectError(body?.message ?? "Could not connect this repository.");
        return;
      }
      setConnection(body);
      setToken("");
    } catch {
      setConnectError("Could not reach the server.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleAnalyze() {
    setTriggering(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/repo-analysis/analyze`, { method: "POST" });
      if (res.ok) setAnalysis(await res.json());
    } finally {
      setTriggering(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${connection?.owner}/${connection?.repo}? This removes the stored token and analysis.`)) {
      return;
    }
    setDisconnecting(true);
    try {
      await fetch(`/api/workspaces/${workspaceId}/repo-analysis/connection`, { method: "DELETE" });
      setConnection(null);
      setAnalysis(null);
    } finally {
      setDisconnecting(false);
    }
  }

  const histogramData =
    analysis?.status === "succeeded"
      ? Object.entries(analysis.targetsByKind ?? {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([kind, count]) => ({ kind, count }))
      : [];

  return (
    <div className="flex flex-col gap-6">
      {!connection ? (
        <Step n={1} title="Connect a GitHub repository">
          <form onSubmit={handleConnect} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Repository URL
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className={field}
                required
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              GitHub personal access token
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="A read-only, repo-scoped token"
                className={field}
                required
              />
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                Create a{" "}
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  fine-grained token
                </a>{" "}
                scoped to this repository with <strong>Contents: Read-only</strong> — nothing more is needed.
              </span>
            </label>
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              Analysis runs your repository&apos;s build scripts in an isolated, hardened container on this
              machine to compute its dependency graph. Only connect repositories you trust.
            </div>
            {connectError && <p className="text-sm text-red-600 dark:text-red-400">{connectError}</p>}
            <button
              type="submit"
              disabled={connecting}
              className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect repository"}
            </button>
          </form>
        </Step>
      ) : (
        <>
          <Step n={1} title="Connected repository">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-zinc-700 dark:text-zinc-300">
                <span className="font-mono font-medium text-zinc-900 dark:text-zinc-50">
                  {connection.owner}/{connection.repo}
                </span>{" "}
                <span className="text-zinc-500 dark:text-zinc-400">
                  ({connection.defaultBranch}, token ending in {connection.tokenLast4})
                </span>
              </div>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </Step>

          <Step n={2} title="Analyze">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={triggering || analysis?.status === "running"}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {analysis?.status === "running" ? "Analyzing…" : "Analyze repository"}
              </button>
              {analysis?.status === "running" && (
                <span
                  role="status"
                  className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"
                >
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  {connected ? "Cloning and running bazel query…" : "Connecting…"}
                </span>
              )}
              {analysis?.status === "failed" && (
                <span className="text-xs text-red-600 dark:text-red-400">{analysis.errorMessage}</span>
              )}
            </div>
            {(analysis?.status === "running" || analysis?.status === "failed") && (
              <LogPanel text={analysis.logTail} failed={analysis.status === "failed"} />
            )}
          </Step>

          {analysis && analysis.status === "succeeded" && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className={`${card} px-4 py-3`}>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Total targets</p>
                  <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{analysis.totalTargets}</p>
                </div>
                <div className={`${card} px-4 py-3`}>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Packages</p>
                  <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{analysis.totalPackages}</p>
                </div>
                <div className={`${card} px-4 py-3`}>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">External dependencies</p>
                  <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {analysis.externalDeps.length}
                  </p>
                </div>
                <div className={`${card} px-4 py-3`}>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Suggested workers</p>
                  <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {(analysis.suggestedNodes.find((n) => n.type === "worker")?.config as { replicas?: number })
                      ?.replicas ?? "—"}
                  </p>
                </div>
              </div>

              {analysis.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  {analysis.warnings.join(" ")}
                </div>
              )}

              <div className={`${card} p-4`}>
                <h2 className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Targets by kind</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={histogramData} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-axis)" }} />
                    <YAxis dataKey="kind" type="category" width={140} tick={{ fill: "var(--chart-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", borderRadius: 6, fontSize: 12 }}
                    />
                    <Bar dataKey="count" fill="var(--chart-categorical-1)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className={`${card} p-4`}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Package dependency graph</h2>
                  {analysis.packageGraph.truncated && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      Showing the {analysis.packageGraph.nodes.length} most-connected packages of {analysis.totalPackages}
                    </span>
                  )}
                </div>
                <PackageGraphView analysis={analysis} />
              </div>

              <div className={`${card} p-4`}>
                <h2 className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">External dependencies</h2>
                <div className="flex flex-wrap gap-2">
                  {analysis.externalDeps.map((d) => (
                    <span
                      key={d.repoName}
                      className="rounded-full bg-black/[.05] px-2.5 py-1 font-mono text-xs text-zinc-700 dark:bg-white/[.08] dark:text-zinc-200"
                    >
                      {d.repoName}
                      {d.version && <span className="text-zinc-400"> @{d.version}</span>}
                    </span>
                  ))}
                </div>
              </div>

              <div className={`${card} p-4`}>
                <h2 className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">Infra suggestion</h2>
                <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                  A rough starting point sized from this repo&apos;s target count — suggested starting point, verify
                  against real build load.
                </p>
                <Link
                  href={`/workspaces/${workspaceId}/cost`}
                  className="text-sm font-medium text-brand underline"
                >
                  See full cost breakdown →
                </Link>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
