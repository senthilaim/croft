"use client";

import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Build } from "@croft/shared-types";

interface DurationChartProps {
  builds: Build[];
}

export function DurationChart({ builds }: DurationChartProps) {
  const data = [...builds]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map((b) => ({
      time: new Date(b.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      durationSec: Math.round((b.totalDurationMs / 1000) * 10) / 10,
      command: b.command,
    }));

  if (data.length === 0) {
    return (
      <p className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        No builds yet
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="time"
          tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
          axisLine={{ stroke: "var(--chart-axis)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={40}
          label={{
            value: "seconds",
            angle: -90,
            position: "insideLeft",
            fill: "var(--chart-muted)",
            fontSize: 12,
          }}
        />
        <Tooltip
          contentStyle={{
            background: "var(--chart-surface)",
            border: "1px solid var(--chart-grid)",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value) => [`${value}s`, "Duration"]}
          labelFormatter={(label, payload) => payload?.[0]?.payload.command ?? label}
        />
        <Line
          type="monotone"
          dataKey="durationSec"
          stroke="var(--chart-sequential)"
          strokeWidth={2}
          dot={{ r: 4, fill: "var(--chart-sequential)", stroke: "var(--chart-surface)", strokeWidth: 2 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
