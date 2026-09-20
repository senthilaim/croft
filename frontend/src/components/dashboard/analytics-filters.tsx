"use client";

import { DEFAULT_FILTERS, RANGES, isDefault, type Filters, type RangeKey, type StatusKey } from "@/lib/analytics";

const STATUS_OPTIONS: Array<{ key: StatusKey; label: string; color: string }> = [
  { key: "success", label: "Succeeded", color: "var(--status-good)" },
  { key: "failure", label: "Failed", color: "var(--status-critical)" },
  { key: "running", label: "Running", color: "var(--status-warning)" },
];

const field =
  "h-9 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100";

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  commands: string[];
  live: boolean;
  onLiveChange: (live: boolean) => void;
  connected: boolean;
}

export function AnalyticsFilters({ filters, onChange, commands, live, onLiveChange, connected }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const toggleStatus = (key: StatusKey) =>
    set({
      statuses: filters.statuses.includes(key)
        ? filters.statuses.filter((s) => s !== key)
        : [...filters.statuses, key],
    });

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Filter invocations</h2>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            disabled={isDefault(filters)}
            className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear all
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          Updates
          <select
            value={live ? "live" : "paused"}
            onChange={(e) => onLiveChange(e.target.value === "live")}
            className="h-8 rounded-lg border border-black/10 bg-white px-2 text-xs text-zinc-800 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="live">{connected ? "Live (WebSocket)" : "Live (reconnecting)"}</option>
            <option value="paused">Paused</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Time range
          <select
            value={filters.range}
            onChange={(e) => set({ range: e.target.value as RangeKey })}
            className={field}
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">Status</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {STATUS_OPTIONS.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={filters.statuses.includes(s.key)}
                  onChange={() => toggleStatus(s.key)}
                  className="h-4 w-4 accent-[var(--color-brand)]"
                />
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Command
          <select value={filters.command} onChange={(e) => set({ command: e.target.value })} className={field}>
            <option value="">Any command</option>
            {commands.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Target pattern
          <input
            value={filters.target}
            onChange={(e) => set({ target: e.target.value })}
            placeholder="Type at least 2 characters, e.g. //app"
            className={field}
          />
        </label>
      </div>
    </section>
  );
}
