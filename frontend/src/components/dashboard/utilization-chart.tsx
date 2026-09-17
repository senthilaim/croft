"use client";

import {
  Line,
  LineChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ContainerRole, InfraTrendSeries } from "@croft/shared-types";

interface UtilizationChartProps {
  series: InfraTrendSeries[];
  hours: number;
}

const ROLE_COLOR_VAR: Record<ContainerRole, string> = {
  server: "var(--chart-categorical-1)",
  worker: "var(--chart-categorical-2)",
  redis: "var(--chart-categorical-3)",
  unknown: "var(--chart-muted)",
};

type MergedRow = { timestamp: string; label: string } & Record<string, number | string>;

function mergeSeries(series: InfraTrendSeries[], hours: number): MergedRow[] {
  const byTimestamp = new Map<string, MergedRow>();
  for (const s of series) {
    for (const p of s.points) {
      const existing = byTimestamp.get(p.timestamp);
      const row: MergedRow =
        existing ?? { timestamp: p.timestamp, label: formatLabel(p.timestamp, hours) };
      row[`${s.containerName}__cpu`] = p.cpuPercent;
      row[`${s.containerName}__mem`] = p.memPercent;
      byTimestamp.set(p.timestamp, row);
    }
  }
  return Array.from(byTimestamp.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function formatLabel(timestamp: string, hours: number): string {
  const date = new Date(timestamp);
  return hours <= 48
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function EmptyState() {
  return (
    <p className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
      No utilization data yet — samples are taken every minute while a Buildfarm is running
    </p>
  );
}

function MetricChart({
  data,
  series,
  metric,
  yLabel,
}: {
  data: MergedRow[];
  series: InfraTrendSeries[];
  metric: "cpu" | "mem";
  yLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--chart-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--chart-axis)" }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "var(--chart-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={36}
          label={{
            value: yLabel,
            angle: -90,
            position: "insideLeft",
            fill: "var(--chart-muted)",
            fontSize: 11,
          }}
        />
        <Tooltip
          contentStyle={{
            background: "var(--chart-surface)",
            border: "1px solid var(--chart-grid)",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value) => [`${value}%`, ""]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--chart-muted)" }} />
        {series.map((s) => (
          <Line
            key={s.containerName}
            type="monotone"
            name={s.containerName}
            dataKey={`${s.containerName}__${metric}`}
            stroke={ROLE_COLOR_VAR[s.role]}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function UtilizationChart({ series, hours }: UtilizationChartProps) {
  const hasData = series.some((s) => s.points.length > 0);
  if (!hasData) return <EmptyState />;

  const data = mergeSeries(series, hours);

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">CPU usage</h3>
        <MetricChart data={data} series={series} metric="cpu" yLabel="% CPU" />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Memory usage</h3>
        <MetricChart data={data} series={series} metric="mem" yLabel="% Mem" />
      </div>
    </div>
  );
}
