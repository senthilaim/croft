"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import Link from "next/link";
import type { BuildSummary, InfraStats } from "@croft/shared-types";
import { StatTile } from "./stat-tile";
import { DurationChart } from "./duration-chart";
import { StatusBadge } from "./status-badge";
import { InfraPanel } from "./infra-panel";
import { AnalyticsFilters } from "./analytics-filters";
import { DemoBanner } from "./demo-banner";
import { CachePanel, FailuresPanel, TargetsPanel } from "./analytics-panels";
import {
  DEFAULT_FILTERS,
  computeKpis,
  filterBuilds,
  formatDuration,
  type Filters,
} from "@/lib/analytics";

type TabKey = "overview" | "failures" | "targets" | "cache";

const FALLBACK_POLL_MS = 5000;

interface LiveDashboardProps {
  workspaceId: string;
  initialBuilds: BuildSummary[];
  initialInfra: InfraStats;
}

export function LiveDashboard({ workspaceId, initialBuilds, initialInfra }: LiveDashboardProps) {
  const [builds, setBuilds] = useState<BuildSummary[]>(initialBuilds);
  const [live, setLive] = useState(true);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<TabKey>("overview");
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const [infra, setInfra] = useState<InfraStats>(initialInfra);
  const [connected, setConnected] = useState(false);

  // Primary path: the backend pushes builds the moment they change and infra every few seconds.
  useEffect(() => {
    const socket: Socket = io({ path: "/ws", addTrailingSlash: false, transports: ["websocket"] });
    const subscribe = () => socket.emit("subscribe", { workspaceId }, (ack?: { ok: boolean }) => setConnected(!!ack?.ok));

    socket.on("connect", subscribe);
    socket.on("disconnect", () => setConnected(false));
    socket.on("unauthorized", () => setConnected(false));
    socket.on("builds", (next: BuildSummary[]) => liveRef.current && setBuilds(next));
    socket.on("infra", (next: InfraStats) => liveRef.current && setInfra(next));

    return () => {
      socket.emit("unsubscribe", { workspaceId });
      socket.disconnect();
    };
  }, [workspaceId]);

  // Safety net only while the socket is down (proxy blocking upgrades, expired token, restart).
  useEffect(() => {
    if (connected || !live) return;
    async function poll() {
      const [buildsRes, infraRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/builds`),
        fetch(`/api/workspaces/${workspaceId}/buildfarm/infra`),
      ]);
      if (buildsRes.ok) setBuilds(await buildsRes.json());
      if (infraRes.ok) setInfra(await infraRes.json());
    }
    const timer = setInterval(poll, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [connected, live, workspaceId]);

  const filtered = useMemo(() => filterBuilds(builds, filters), [builds, filters]);
  const kpis = useMemo(() => computeKpis(filtered), [filtered]);
  const commands = useMemo(() => [...new Set(builds.map((b) => b.command))].sort(), [builds]);
  const failedCount = kpis.failed;

  const tabs: Array<{ key: TabKey; label: string; badge?: number }> = [
    { key: "overview", label: "Overview" },
    { key: "failures", label: "Failures", badge: failedCount },
    { key: "targets", label: "Targets" },
    { key: "cache", label: "Remote cache" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="relative flex h-2 w-2">
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${live && connected ? "bg-green-400" : "bg-amber-400"}`}
          />
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${live && connected ? "bg-green-500" : "bg-amber-500"}`}
          />
        </span>
        {!live
          ? "Updates paused — showing a snapshot"
          : connected
            ? "Live — pushed over WebSocket"
            : `Reconnecting — refreshing every ${FALLBACK_POLL_MS / 1000}s`}
        <span className="ml-2 text-zinc-400 dark:text-zinc-500">
          Showing {filtered.length} of {builds.length} loaded invocations
        </span>
      </div>

      <DemoBanner
        workspaceId={workspaceId}
        hasDemo={builds.some((b) => b.demo)}
        hasBuilds={builds.length > 0}
      />

      <AnalyticsFilters
        filters={filters}
        onChange={setFilters}
        commands={commands}
        live={live}
        onLiveChange={setLive}
        connected={connected}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total invocations" value={String(kpis.total)} />
        <StatTile
          label="Success rate"
          value={kpis.successRate === null ? "—" : `${kpis.successRate}%`}
          valueColorVar={
            kpis.successRate === null
              ? undefined
              : kpis.successRate >= 90
                ? "var(--status-good)"
                : kpis.successRate >= 60
                  ? "var(--status-warning)"
                  : "var(--status-critical)"
          }
          sub={`${kpis.passed} passed, ${kpis.failed} failed`}
        />
        <StatTile
          label="Avg invocation time"
          value={formatDuration(kpis.avgDurationMs)}
          sub={kpis.p90DurationMs === null ? undefined : `p90 ${formatDuration(kpis.p90DurationMs)}`}
        />
        <StatTile
          label="Remote hit share"
          value={kpis.remoteHitShare === null ? "—" : `${kpis.remoteHitShare}%`}
          valueColorVar={kpis.remoteHitShare === null ? undefined : "var(--chart-sequential)"}
          sub={`${kpis.remoteHits} remote hits / ${kpis.actionsRun} actions`}
          info="Share of executed actions whose results were served from the Buildfarm remote cache instead of being run."
        />
        <StatTile label="Running now" value={String(kpis.running)} dotColorVar="var(--status-warning)" />
        <StatTile label="Failed" value={String(kpis.failed)} dotColorVar="var(--status-critical)" />
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-black/10 dark:border-white/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-brand text-black dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            {t.label}
            {t.badge ? (
              <span className="ml-2 rounded-full bg-black/[.06] px-1.5 py-0.5 text-[11px] dark:bg-white/[.1]">
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "failures" && <FailuresPanel builds={filtered} workspaceId={workspaceId} />}
      {tab === "targets" && <TargetsPanel builds={filtered} />}
      {tab === "cache" && <CachePanel builds={filtered} />}

      {tab === "overview" && (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <h2 className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Build duration over time
              </h2>
              <DurationChart builds={filtered} />
            </div>

            <div className="rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <h2 className="border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200">
                Infrastructure
              </h2>
              <InfraPanel containers={infra.containers} />
            </div>
          </div>

      <div className="rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200">
          Recent builds
        </h2>
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500">
            No invocations match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Command</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Targets</th>
                <th className="px-4 py-2 font-medium">Cache</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Reason</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((build) => (
                <tr
                  key={build.id}
                  className="border-t border-black/5 text-zinc-700 dark:border-white/5 dark:text-zinc-300"
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    {build.command}
                    {build.demo && (
                      <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        Demo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={build.status} />
                  </td>
                  <td className="px-4 py-2">{build.targets.length}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {build.actionsExecuted > 0
                      ? `${build.remoteCacheHits} remote hit / ${build.actionsExecuted - build.remoteCacheHits} ran`
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {build.status === "running"
                      ? "—"
                      : `${(build.totalDurationMs / 1000).toFixed(1)}s`}
                  </td>
                  <td className="px-4 py-2" suppressHydrationWarning>
                    {new Date(build.startTime).toLocaleString()}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 text-xs text-red-600 dark:text-red-400">
                    {build.errorMessage ? (
                      <span title={build.errorMessage}>{build.errorMessage}</span>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/workspaces/${workspaceId}/builds/${build.id}`}
                      className="text-xs whitespace-nowrap text-zinc-500 hover:underline dark:text-zinc-400"
                    >
                      View details →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
