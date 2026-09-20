import type { BuildSummary } from "@croft/shared-types";

export type RangeKey = "1h" | "24h" | "7d" | "15d" | "30d" | "all";
export type StatusKey = "success" | "failure" | "running";

export const RANGES: Array<{ key: RangeKey; label: string; ms: number | null }> = [
  { key: "1h", label: "Last hour", ms: 3_600_000 },
  { key: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { key: "15d", label: "Last 15 days", ms: 15 * 86_400_000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
  { key: "all", label: "All loaded", ms: null },
];

export interface Filters {
  range: RangeKey;
  statuses: StatusKey[];
  command: string;
  target: string;
}

export const DEFAULT_FILTERS: Filters = { range: "all", statuses: [], command: "", target: "" };

export function isDefault(f: Filters): boolean {
  return (
    f.range === DEFAULT_FILTERS.range &&
    f.statuses.length === 0 &&
    f.command === "" &&
    f.target.trim() === ""
  );
}

export function filterBuilds(builds: BuildSummary[], f: Filters, now = Date.now()): BuildSummary[] {
  const rangeMs = RANGES.find((r) => r.key === f.range)?.ms ?? null;
  const pattern = f.target.trim().toLowerCase();
  return builds.filter((b) => {
    if (rangeMs !== null && now - new Date(b.startTime).getTime() > rangeMs) return false;
    if (f.statuses.length > 0 && !f.statuses.includes(b.status)) return false;
    if (f.command && b.command !== f.command) return false;
    if (pattern.length >= 2 && !b.targets.some((t) => t.label.toLowerCase().includes(pattern))) {
      return false;
    }
    return true;
  });
}

export interface Kpis {
  total: number;
  passed: number;
  failed: number;
  running: number;
  successRate: number | null;
  avgDurationMs: number | null;
  p90DurationMs: number | null;
  remoteHits: number;
  actionsRun: number;
  remoteHitShare: number | null;
}

export function computeKpis(builds: BuildSummary[]): Kpis {
  const finished = builds.filter((b) => b.status !== "running");
  const passed = builds.filter((b) => b.status === "success").length;
  const failed = builds.filter((b) => b.status === "failure").length;
  const durations = finished.map((b) => b.totalDurationMs).sort((a, b) => a - b);
  const remoteHits = builds.reduce((sum, b) => sum + b.remoteCacheHits, 0);
  const actionsRun = builds.reduce((sum, b) => sum + b.actionsExecuted, 0);
  return {
    total: builds.length,
    passed,
    failed,
    running: builds.length - finished.length,
    successRate: finished.length > 0 ? Math.round((passed / finished.length) * 100) : null,
    avgDurationMs:
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    p90DurationMs:
      durations.length > 0 ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.9))] : null,
    remoteHits,
    actionsRun,
    remoteHitShare: actionsRun > 0 ? Math.round((remoteHits / actionsRun) * 100) : null,
  };
}

export interface FailureGroup {
  title: string;
  category: string;
  count: number;
  latest: string;
  example: string;
}

export function failureGroups(builds: BuildSummary[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const b of builds) {
    if (b.status !== "failure") continue;
    const title = b.failure?.title ?? "Unclassified failure";
    const g = groups.get(title) ?? {
      title,
      category: b.failure?.category ?? "other",
      count: 0,
      latest: b.startTime,
      example: b.failure?.message ?? b.errorMessage ?? "",
    };
    g.count += 1;
    if (b.startTime > g.latest) g.latest = b.startTime;
    groups.set(title, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export interface FileHotspot {
  location: string;
  count: number;
  title: string;
}

export function failureHotspots(builds: BuildSummary[]): FileHotspot[] {
  const spots = new Map<string, FileHotspot>();
  for (const b of builds) {
    if (b.status !== "failure" || !b.failure?.file) continue;
    const location = b.failure.line ? `${b.failure.file}:${b.failure.line}` : b.failure.file;
    const s = spots.get(location) ?? { location, count: 0, title: b.failure.title };
    s.count += 1;
    spots.set(location, s);
  }
  return [...spots.values()].sort((a, b) => b.count - a.count);
}

export interface TargetStat {
  label: string;
  runs: number;
  failures: number;
  failureRate: number;
  avgDurationMs: number;
}

export function targetStats(builds: BuildSummary[]): TargetStat[] {
  const stats = new Map<string, { runs: number; failures: number; totalMs: number }>();
  for (const b of builds) {
    for (const t of b.targets) {
      const s = stats.get(t.label) ?? { runs: 0, failures: 0, totalMs: 0 };
      s.runs += 1;
      if (t.status === "failure") s.failures += 1;
      s.totalMs += t.durationMs;
      stats.set(t.label, s);
    }
  }
  return [...stats.entries()]
    .map(([label, s]) => ({
      label,
      runs: s.runs,
      failures: s.failures,
      failureRate: Math.round((s.failures / s.runs) * 100),
      avgDurationMs: s.totalMs / s.runs,
    }))
    .sort((a, b) => b.failures - a.failures || b.runs - a.runs);
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
