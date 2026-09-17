import Link from "next/link";
import type { TestGridRow, TestRunStatus } from "@croft/shared-types";

interface TestGridProps {
  workspaceId: string;
  rows: TestGridRow[];
}

const STATUS_COLOR_VAR: Record<TestRunStatus, string> = {
  passed: "var(--status-good)",
  flaky: "var(--status-warning)",
  timeout: "var(--status-critical)",
  failed: "var(--status-critical)",
  incomplete: "var(--status-critical)",
  no_status: "var(--chart-muted)",
};

const STATUS_LABEL: Record<TestRunStatus, string> = {
  passed: "Passed",
  flaky: "Flaky (this run)",
  timeout: "Timed out",
  failed: "Failed",
  incomplete: "Incomplete",
  no_status: "No status",
};

function StatusPill({
  status,
  startTime,
  totalDurationMs,
}: {
  status: TestRunStatus;
  startTime: string;
  totalDurationMs: number;
}) {
  const title = `${STATUS_LABEL[status]} — ${new Date(startTime).toLocaleString()} — ${(totalDurationMs / 1000).toFixed(1)}s`;
  return (
    <span
      title={title}
      className="inline-block h-4 w-4 shrink-0 rounded-sm"
      style={{ backgroundColor: STATUS_COLOR_VAR[status] }}
    />
  );
}

function Legend() {
  const entries: TestRunStatus[] = ["passed", "flaky", "failed"];
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
      {entries.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: STATUS_COLOR_VAR[status] }}
          />
          {STATUS_LABEL[status]}
        </span>
      ))}
      <span>Oldest → newest, left to right</span>
    </div>
  );
}

export function TestGrid({ workspaceId, rows }: TestGridProps) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500">
        No test results yet — run <code>bazel test</code> against a target in your sample project.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Legend />
      <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {row.isFlaky && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: "var(--status-warning)",
                    color: "#1a1a19",
                  }}
                >
                  Flaky
                </span>
              )}
              <Link
                href={`/workspaces/${workspaceId}/builds/${row.runs[0]?.buildId ?? ""}`}
                className="truncate font-mono text-sm text-zinc-700 hover:underline dark:text-zinc-300"
                title={row.label}
              >
                {row.label}
              </Link>
            </div>
            <div className="flex shrink-0 gap-1">
              {[...row.runs].reverse().map((run, index) => (
                <StatusPill
                  key={`${row.label}-${index}-${run.startTime}`}
                  status={run.status}
                  startTime={run.startTime}
                  totalDurationMs={run.totalDurationMs}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
