import type { ContainerStats } from "@bazel-bootstrap/shared-types";

const ROLE_LABEL: Record<ContainerStats["role"], string> = {
  server: "Server",
  worker: "Worker",
  redis: "Redis Backplane",
  unknown: "Container",
};

function Bar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
      <div
        className="h-full rounded-full"
        style={{ width: `${clamped}%`, backgroundColor: "var(--chart-sequential)" }}
      />
    </div>
  );
}

export function InfraPanel({ containers }: { containers: ContainerStats[] }) {
  if (containers.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500">
        No running containers for this workspace.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
      {containers.map((c) => (
        <div key={c.id} className="flex flex-col gap-1.5 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {ROLE_LABEL[c.role]}
            </span>
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{c.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>CPU</span>
                <span>{c.cpuPercent.toFixed(1)}%</span>
              </div>
              <Bar percent={c.cpuPercent} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Memory</span>
                <span>
                  {c.memUsageMb.toFixed(0)} / {c.memLimitMb.toFixed(0)} MB
                </span>
              </div>
              <Bar percent={c.memPercent} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
