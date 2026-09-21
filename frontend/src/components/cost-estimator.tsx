"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CostEstimate, CostReport } from "@croft/shared-types";

const field =
  "h-9 rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100";
const card =
  "rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900";

const money = (n: number | null, digits = 0) =>
  n === null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const SHORT: Record<string, string> = {
  docker: "Your machine",
  aws: "AWS",
  gcp: "Google Cloud",
  azure: "Azure",
  onprem: "On-prem",
};

export function CostEstimator({ workspaceId }: { workspaceId: string }) {
  const [hoursPerDay, setHoursPerDay] = useState("24");
  const [pricing, setPricing] = useState<"ondemand" | "spot">("ondemand");
  const [builds, setBuilds] = useState("");
  const [rate, setRate] = useState("0.02");
  const [report, setReport] = useState<CostReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const qs = new URLSearchParams({ hoursPerDay, onPremVcpuHour: rate });
      if (builds !== "") qs.set("buildsPerMonth", builds);
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/cost?${qs}`, { signal: controller.signal });
        if (res.ok) {
          setReport(await res.json());
          setError(null);
        } else {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? "Could not calculate the estimate.");
        }
      } catch {
        /* superseded by a newer request */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workspaceId, hoursPerDay, builds, rate]);

  const spot = pricing === "spot";
  const chartData = (report?.estimates ?? []).map((e) => {
    const total = spot && e.spotMonthly !== null ? e.spotMonthly : e.totalMonthly;
    const storage = e.storageMonthly;
    return { name: SHORT[e.provider], Compute: Math.max(0, Math.round((total - storage) * 100) / 100), Storage: storage };
  });
  const cheapestCloud = report?.estimates
    .filter((e) => ["aws", "gcp", "azure"].includes(e.provider))
    .map((e) => ({ e, v: spot && e.spotMonthly !== null ? e.spotMonthly : e.totalMonthly }))
    .sort((a, b) => a.v - b.v)[0];

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!report) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Calculating…</p>;

  const req = report.requirements;

  return (
    <div className="flex flex-col gap-6">
      <section className={`${card} p-4`}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            How long does it run each day?
            <select value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} className={field}>
              <option value="24">24 h (always on)</option>
              <option value="12">12 h (working day)</option>
              <option value="8">8 h (office hours)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Pricing
            <select value={pricing} onChange={(e) => setPricing(e.target.value as "ondemand" | "spot")} className={field}>
              <option value="ondemand">On-demand</option>
              <option value="spot">Spot / preemptible</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Builds per month{" "}
            <span className="font-normal text-zinc-500 dark:text-zinc-400">
              ({report.usage.buildsMeasured ? `measured: ${report.usage.buildsPerMonth}` : "your estimate"})
            </span>
            <input
              inputMode="numeric"
              value={builds}
              onChange={(e) => setBuilds(e.target.value.replace(/\D/g, ""))}
              placeholder={String(report.usage.buildsPerMonth)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            On-prem $/vCPU-hour
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={field} />
          </label>
        </div>
      </section>

      <section className={`${card} p-4`}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">What your design needs</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {req.nodes.map((n) => (
            <span key={n.role} className="rounded-full bg-black/[.05] px-3 py-1 text-zinc-700 dark:bg-white/[.08] dark:text-zinc-200">
              {n.replicas > 1 ? `${n.replicas} × ` : ""}
              {n.role}: {n.vcpu} vCPU, {n.memGb} GB
            </span>
          ))}
          <span className="rounded-full bg-brand-soft px-3 py-1 font-medium text-brand dark:text-zinc-50">
            Total {req.vcpu} vCPU · {req.memGb} GB RAM · {req.storageGb} GB storage
          </span>
        </div>
        {req.nodes.length === 0 && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            This workspace has no saved design yet, so the numbers below are for an empty farm. Design and save a
            Buildfarm in the designer first.
          </p>
        )}
      </section>

      {cheapestCloud && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
          Cheapest cloud option: <strong>{SHORT[cheapestCloud.e.provider]}</strong> at about{" "}
          <strong>{money(cheapestCloud.v)}/month</strong>
          {spot ? " (spot)" : ""}
          {cheapestCloud.e.perBuild !== null && ` — roughly ${money(cheapestCloud.e.perBuild, 2)} per build`}.
        </div>
      )}

      <section className={`${card} p-4`}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Estimated monthly cost by hosting option {spot ? "(spot)" : "(on-demand)"}
        </h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
            <YAxis tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", borderRadius: 6, fontSize: 12 }}
              formatter={(v, name) => [`$${Number(v).toFixed(2)}`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--chart-text-secondary)" }} />
            <Bar dataKey="Compute" stackId="a" fill="var(--chart-categorical-1)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Storage" stackId="a" fill="var(--chart-categorical-3)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className={`${card} overflow-x-auto`}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Option</th>
              <th className="px-4 py-3 font-medium">Machines</th>
              <th className="px-4 py-3 font-medium">Compute</th>
              <th className="px-4 py-3 font-medium">Storage</th>
              <th className="px-4 py-3 font-medium">On-demand / month</th>
              <th className="px-4 py-3 font-medium">Spot / month</th>
              <th className="px-4 py-3 font-medium">Per build</th>
            </tr>
          </thead>
          <tbody>
            {report.estimates.map((e: CostEstimate) => (
              <tr key={e.provider} className="border-t border-black/5 align-top text-zinc-700 dark:border-white/5 dark:text-zinc-300">
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{e.label}</td>
                <td className="px-4 py-3 text-xs">
                  {e.instance ? `${e.instance.count} × ${e.instance.type}` : "—"}
                </td>
                <td className="px-4 py-3">{money(e.computeMonthly)}</td>
                <td className="px-4 py-3">{money(e.storageMonthly)}</td>
                <td className="px-4 py-3 font-semibold">{money(e.totalMonthly)}</td>
                <td className="px-4 py-3">{money(e.spotMonthly)}</td>
                <td className="px-4 py-3">{money(e.perBuild, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${card} p-4 text-xs text-zinc-600 dark:text-zinc-300`}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">How to read this</h2>
        <ul className="list-disc space-y-1 pl-5">
          {report.estimates
            .filter((e) => e.provider !== "docker" && e.provider !== "onprem")
            .slice(0, 1)
            .map((e) => (
              <li key={e.provider}>{e.notes[1]}</li>
            ))}
          <li>
            Spot/preemptible capacity is much cheaper but can be reclaimed; it suits workers (builds retry) better than
            the server or Redis.
          </li>
          <li>Shutting the farm down outside working hours cuts compute cost roughly in proportion to the hours saved.</li>
        </ul>
        <p className="mt-3 text-zinc-500 dark:text-zinc-400">
          {report.disclaimer} Prices as of {report.pricesAsOf}.
        </p>
      </section>
    </div>
  );
}
