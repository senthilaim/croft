import type { BuildfarmInstanceStatus } from "@bazel-bootstrap/shared-types";

const STATUS_LABEL: Record<BuildfarmInstanceStatus, string> = {
  running: "Running",
  provisioning: "Provisioning",
  error: "Error",
  stopped: "Stopped",
};

const STATUS_COLOR_VAR: Record<BuildfarmInstanceStatus, string> = {
  running: "var(--status-good)",
  provisioning: "var(--status-warning)",
  error: "var(--status-critical)",
  stopped: "var(--chart-muted)",
};

export function BuildfarmStatusBadge({ status }: { status: BuildfarmInstanceStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-zinc-700 dark:border-white/10 dark:text-zinc-300">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: STATUS_COLOR_VAR[status] }}
        aria-hidden
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
