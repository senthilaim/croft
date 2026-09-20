"use client";

import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BuildSummary } from "@croft/shared-types";
import { failureGroups, failureHotspots, formatDuration, targetStats } from "@/lib/analytics";

const card =
  "rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900";
const cardTitle =
  "border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200";
const muted = "px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500";
const th = "px-4 py-2 font-medium";

export function FailuresPanel({ builds, workspaceId }: { builds: BuildSummary[]; workspaceId: string }) {
  const groups = failureGroups(builds);
  const hotspots = failureHotspots(builds).slice(0, 8);
  const failed = builds.filter((b) => b.status === "failure");
  const max = groups[0]?.count ?? 1;

  if (failed.length === 0) {
    return <div className={card}><p className={muted}>No failed invocations in this selection.</p></div>;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className={card}>
        <h2 className={cardTitle}>Top failure causes</h2>
        <ul className="flex flex-col gap-3 px-4 py-4">
          {groups.map((g) => (
            <li key={g.title}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {g.title}
                  <span className="ml-2 rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] font-normal text-zinc-600 dark:bg-white/[.08] dark:text-zinc-300">
                    {g.category}
                  </span>
                </span>
                <span className="shrink-0 text-zinc-600 dark:text-zinc-300">{g.count}×</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(g.count / max) * 100}%`, backgroundColor: "var(--status-critical)" }}
                />
              </div>
              {g.example && (
                <p className="mt-1.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400" title={g.example}>
                  {g.example}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className={card}>
        <h2 className={cardTitle}>Most-failing locations</h2>
        {hotspots.length === 0 ? (
          <p className={muted}>No failure had a file location.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                <th className={th}>Location</th>
                <th className={th}>Cause</th>
                <th className={`${th} text-right`}>Times</th>
              </tr>
            </thead>
            <tbody>
              {hotspots.map((h) => (
                <tr key={h.location} className="border-t border-black/5 text-zinc-700 dark:border-white/5 dark:text-zinc-300">
                  <td className="max-w-sm break-all px-4 py-2 font-mono text-xs">{h.location}</td>
                  <td className="px-4 py-2 text-xs">{h.title}</td>
                  <td className="px-4 py-2 text-right">{h.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={`${card} xl:col-span-2`}>
        <h2 className={cardTitle}>Failed invocations</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                <th className={th}>Started</th>
                <th className={th}>Command</th>
                <th className={th}>Cause</th>
                <th className={th}>Location</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {failed.slice(0, 25).map((b) => (
                <tr key={b.id} className="border-t border-black/5 text-zinc-700 dark:border-white/5 dark:text-zinc-300">
                  <td className="whitespace-nowrap px-4 py-2 text-xs">{new Date(b.startTime).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{b.command}</td>
                  <td className="px-4 py-2 text-xs">{b.failure?.title ?? "Unclassified"}</td>
                  <td className="max-w-md break-all px-4 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {b.failure?.file ? `${b.failure.file}${b.failure.line ? `:${b.failure.line}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/workspaces/${workspaceId}/builds/${b.id}`}
                      className="whitespace-nowrap text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                    >
                      View details →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function TargetsPanel({ builds }: { builds: BuildSummary[] }) {
  const stats = targetStats(builds).slice(0, 50);
  return (
    <div className={card}>
      <h2 className={cardTitle}>Targets</h2>
      {stats.length === 0 ? (
        <p className={muted}>No target data yet. Targets appear once a build completes them.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                <th className={th}>Target</th>
                <th className={th}>Runs</th>
                <th className={th}>Failures</th>
                <th className={th}>Failure rate</th>
                <th className={th}>Avg duration</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((t) => (
                <tr key={t.label} className="border-t border-black/5 text-zinc-700 dark:border-white/5 dark:text-zinc-300">
                  <td className="px-4 py-2 font-mono text-xs">{t.label}</td>
                  <td className="px-4 py-2">{t.runs}</td>
                  <td className="px-4 py-2">{t.failures}</td>
                  <td className="px-4 py-2">
                    <span style={{ color: t.failureRate > 0 ? "var(--status-critical)" : undefined }}>
                      {t.failureRate}%
                    </span>
                  </td>
                  <td className="px-4 py-2">{formatDuration(t.avgDurationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CachePanel({ builds }: { builds: BuildSummary[] }) {
  const withActions = builds
    .filter((b) => b.actionsExecuted > 0)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const data = withActions.map((b) => ({
    time: new Date(b.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    hitRate: Math.round((b.remoteCacheHits / b.actionsExecuted) * 100),
    hits: b.remoteCacheHits,
    ran: b.actionsExecuted - b.remoteCacheHits,
  }));
  const hits = withActions.reduce((s, b) => s + b.remoteCacheHits, 0);
  const total = withActions.reduce((s, b) => s + b.actionsExecuted, 0);

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className={`${card} xl:col-span-2`}>
        <h2 className={cardTitle}>Remote cache hit rate per invocation</h2>
        <div className="p-4">
          {data.length === 0 ? (
            <p className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
              No invocations with executed actions yet
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", borderRadius: 6, fontSize: 12 }}
                  formatter={(value, _name, item) => [
                    `${value}% (${item.payload.hits} hit / ${item.payload.ran} ran)`,
                    "Cache hit rate",
                  ]}
                />
                <Line type="linear" dataKey="hitRate" stroke="var(--chart-categorical-3)" strokeWidth={2} dot={{ r: 4, fill: "var(--chart-categorical-3)", stroke: "var(--chart-surface)", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className={card}>
        <h2 className={cardTitle}>Totals</h2>
        <dl className="flex flex-col gap-3 px-4 py-4 text-sm">
          {[
            ["Actions executed", String(total)],
            ["Served from remote cache", String(hits)],
            ["Executed on worker / locally", String(total - hits)],
            ["Overall hit share", total > 0 ? `${Math.round((hits / total) * 100)}%` : "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
              <dd className="font-semibold text-zinc-900 dark:text-zinc-50">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
