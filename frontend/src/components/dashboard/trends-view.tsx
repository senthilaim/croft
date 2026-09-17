"use client";

import { useState, useTransition } from "react";
import type { BuildTrendPoint, InfraTrendSeries } from "@croft/shared-types";
import { BuildTrendCharts } from "./build-trend-charts";
import { UtilizationChart } from "./utilization-chart";

interface TrendsViewProps {
  workspaceId: string;
  initialBuildTrends: BuildTrendPoint[];
  initialInfraTrends: InfraTrendSeries[];
}

const RANGES = [
  { label: "24h", days: 1, hours: 24 },
  { label: "7d", days: 7, hours: 168 },
  { label: "30d", days: 30, hours: 168 },
] as const;

export function TrendsView({ workspaceId, initialBuildTrends, initialInfraTrends }: TrendsViewProps) {
  const [rangeIndex, setRangeIndex] = useState(1);
  const [buildTrends, setBuildTrends] = useState(initialBuildTrends);
  const [infraTrends, setInfraTrends] = useState(initialInfraTrends);
  const [isPending, startTransition] = useTransition();

  function selectRange(index: number) {
    setRangeIndex(index);
    const range = RANGES[index];
    startTransition(async () => {
      const [buildsRes, infraRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/builds/trends?days=${range.days}`),
        fetch(`/api/workspaces/${workspaceId}/buildfarm/infra/trends?hours=${range.hours}`),
      ]);
      if (buildsRes.ok) setBuildTrends(await buildsRes.json());
      if (infraRes.ok) setInfraTrends(await infraRes.json());
    });
  }

  const range = RANGES[rangeIndex];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-1 self-start rounded-lg border border-black/10 p-1 dark:border-white/10">
        {RANGES.map((r, index) => (
          <button
            key={r.label}
            type="button"
            onClick={() => selectRange(index)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              index === rangeIndex
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "text-zinc-600 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
            }`}
          >
            {r.label}
          </button>
        ))}
        {isPending && <span className="px-2 text-xs text-zinc-400 dark:text-zinc-500">Loading…</span>}
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-medium text-zinc-800 dark:text-zinc-200">Build trends</h2>
        <BuildTrendCharts points={buildTrends} />
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Executor utilization
        </h2>
        <UtilizationChart series={infraTrends} hours={range.hours} />
      </div>
    </div>
  );
}
