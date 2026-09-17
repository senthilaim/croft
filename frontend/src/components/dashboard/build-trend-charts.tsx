"use client";

import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BuildTrendPoint } from "@croft/shared-types";

interface BuildTrendChartsProps {
  points: BuildTrendPoint[];
}

function formatDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" });
}

function EmptyState() {
  return (
    <p className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
      No builds in this range
    </p>
  );
}

export function BuildTrendCharts({ points }: BuildTrendChartsProps) {
  if (points.length === 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <EmptyState />
        <EmptyState />
      </div>
    );
  }

  const durationData = points.map((p) => ({
    label: formatDateLabel(p.date),
    durationSec: Math.round((p.avgDurationMs / 1000) * 10) / 10,
    buildCount: p.buildCount,
  }));
  const cacheData = points.map((p) => ({
    label: formatDateLabel(p.date),
    cacheHitRate: p.cacheHitRate,
    buildCount: p.buildCount,
  }));

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Avg build duration / day
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={durationData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--chart-muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--chart-axis)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--chart-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: "var(--chart-surface)",
                border: "1px solid var(--chart-grid)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(value) => [`${value}s`, "Avg duration"]}
              labelFormatter={(label, payload) => {
                const count = payload?.[0]?.payload.buildCount;
                return count ? `${label} — ${count} build${count === 1 ? "" : "s"}` : label;
              }}
            />
            <Line
              type="monotone"
              dataKey="durationSec"
              stroke="var(--chart-sequential)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--chart-sequential)", stroke: "var(--chart-surface)", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Remote cache hit rate / day
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={cacheData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--chart-muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--chart-axis)" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "var(--chart-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: "var(--chart-surface)",
                border: "1px solid var(--chart-grid)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(value) => [value === null ? "—" : `${value}%`, "Cache hit rate"]}
            />
            <Line
              type="monotone"
              dataKey="cacheHitRate"
              stroke="var(--chart-categorical-3)"
              strokeWidth={2}
              connectNulls
              dot={{ r: 3, fill: "var(--chart-categorical-3)", stroke: "var(--chart-surface)", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
