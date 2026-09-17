import type { BuildStatus } from "@croft/shared-types";

const STATUS_LABEL: Record<BuildStatus, string> = {
  success: "Success",
  failure: "Failure",
  running: "Running",
};

const STATUS_COLOR_VAR: Record<BuildStatus, string> = {
  success: "var(--status-good)",
  failure: "var(--status-critical)",
  running: "var(--status-warning)",
};

export function StatusBadge({ status }: { status: BuildStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: STATUS_COLOR_VAR[status] }}
        aria-hidden
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
