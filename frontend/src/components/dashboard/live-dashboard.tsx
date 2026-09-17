"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Build, InfraStats } from "@croft/shared-types";
import { StatTile } from "./stat-tile";
import { DurationChart } from "./duration-chart";
import { StatusBadge } from "./status-badge";
import { InfraPanel } from "./infra-panel";

const POLL_INTERVAL_MS = 2000;

interface LiveDashboardProps {
  workspaceId: string;
  initialBuilds: Build[];
  initialInfra: InfraStats;
}

export function LiveDashboard({ workspaceId, initialBuilds, initialInfra }: LiveDashboardProps) {
  const [builds, setBuilds] = useState<Build[]>(initialBuilds);
  const [infra, setInfra] = useState<InfraStats>(initialInfra);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function poll() {
      const [buildsRes, infraRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/builds`),
        fetch(`/api/workspaces/${workspaceId}/buildfarm/infra`),
      ]);
      if (buildsRes.ok) setBuilds(await buildsRes.json());
      if (infraRes.ok) setInfra(await infraRes.json());
    }

    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [workspaceId]);

  const total = builds.length;
  const successCount = builds.filter((b) => b.status === "success").length;
  const failureCount = builds.filter((b) => b.status === "failure").length;
  const runningCount = builds.filter((b) => b.status === "running").length;
  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  const totalRemoteCacheHits = builds.reduce((sum, b) => sum + b.remoteCacheHits, 0);
  const totalActionsExecuted = builds.reduce((sum, b) => sum + b.actionsExecuted, 0);
  const cacheHitRate =
    totalActionsExecuted > 0 ? Math.round((totalRemoteCacheHits / totalActionsExecuted) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        Live — updates every {POLL_INTERVAL_MS / 1000}s
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total builds" value={String(total)} />
        <StatTile label="Success rate" value={`${successRate}%`} />
        <StatTile label="Running" value={String(runningCount)} dotColorVar="var(--status-warning)" />
        <StatTile label="Successful" value={String(successCount)} dotColorVar="var(--status-good)" />
        <StatTile label="Failed" value={String(failureCount)} dotColorVar="var(--status-critical)" />
        <StatTile
          label="Remote cache hit rate"
          value={cacheHitRate === null ? "—" : `${cacheHitRate}%`}
        />
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Build duration over time
        </h2>
        <DurationChart builds={builds} />
      </div>

      <div className="rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200">
          Infrastructure
        </h2>
        <InfraPanel containers={infra.containers} />
      </div>

      <div className="rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200">
          Recent builds
        </h2>
        {builds.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500">
            No builds reported yet.
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
              {builds.map((build) => (
                <tr
                  key={build.id}
                  className="border-t border-black/5 text-zinc-700 dark:border-white/5 dark:text-zinc-300"
                >
                  <td className="px-4 py-2 font-mono text-xs">{build.command}</td>
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
                  <td className="px-4 py-2">{new Date(build.startTime).toLocaleString()}</td>
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
    </div>
  );
}
