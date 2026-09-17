"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WaterfallSpan } from "@croft/shared-types";

interface BuildWaterfallProps {
  spans: WaterfallSpan[];
}

interface WaterfallRow {
  row: string;
  offset: number;
  duration: number;
  name: string;
  category: string;
  lane: string;
}

const ROW_HEIGHT = 22;

function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; payload: WaterfallRow }>;
}) {
  const point = active ? payload?.find((p) => p.dataKey === "duration")?.payload : undefined;
  if (!point) return null;
  return (
    <div
      className="rounded-md border px-2.5 py-1.5 text-xs"
      style={{ background: "var(--chart-surface)", borderColor: "var(--chart-grid)" }}
    >
      <div className="font-medium text-zinc-800 dark:text-zinc-100">{point.name || "(unnamed)"}</div>
      <div style={{ color: "var(--chart-muted)" }}>
        {point.lane}
        {point.category ? ` · ${point.category}` : ""}
      </div>
      <div className="text-zinc-700 dark:text-zinc-300">{(point.duration / 1000).toFixed(2)}s</div>
    </div>
  );
}

export function BuildWaterfall({ spans }: BuildWaterfallProps) {
  if (spans.length === 0) {
    return (
      <p className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        Timing waterfall unavailable for this build
      </p>
    );
  }

  const data: WaterfallRow[] = [...spans]
    .sort((a, b) => a.startMs - b.startMs)
    .map((span, index) => ({
      row: `row-${index}`,
      offset: span.startMs,
      duration: span.durationMs,
      name: span.name,
      category: span.category,
      lane: span.lane,
    }));
  const maxEndMs = Math.max(...data.map((d) => d.offset + d.duration));

  return (
    <div className="max-h-[480px] overflow-y-auto overflow-x-hidden">
      <ResponsiveContainer width="100%" height={Math.max(data.length * ROW_HEIGHT, 120)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, maxEndMs]}
            tickFormatter={(value: number) => `${(value / 1000).toFixed(1)}s`}
            tick={{ fill: "var(--chart-muted)", fontSize: 11 }}
            axisLine={{ stroke: "var(--chart-axis)" }}
            tickLine={false}
          />
          <YAxis type="category" dataKey="row" tick={false} axisLine={false} tickLine={false} width={4} />
          <Tooltip content={<WaterfallTooltip />} cursor={{ fill: "var(--chart-grid)", opacity: 0.4 }} />
          <Bar dataKey="offset" stackId="a" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="duration"
            stackId="a"
            fill="var(--chart-sequential)"
            radius={[3, 3, 3, 3]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
