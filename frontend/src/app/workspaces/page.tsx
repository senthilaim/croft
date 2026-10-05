import Link from "next/link";
import { redirect } from "next/navigation";
import type { BuildfarmInstance, BuildSummary, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { StatTile } from "@/components/dashboard/stat-tile";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { computeKpis, formatDuration } from "@/lib/analytics";

const INSTANCE_STATUS_LABEL: Record<BuildfarmInstance["status"], string> = {
  running: "Running",
  provisioning: "Provisioning",
  error: "Error",
  stopped: "Stopped",
};

// Same convention as the Designer canvas's own status coloring (buildfarm-canvas.tsx).
function instanceStatusColor(status: BuildfarmInstance["status"] | "none"): string {
  if (status === "running") return "text-green-600 dark:text-green-400";
  if (status === "error") return "text-red-600 dark:text-red-400";
  if (status === "none") return "text-zinc-400 dark:text-zinc-500";
  return "text-amber-600 dark:text-amber-400";
}

const BUILDS_PER_WORKSPACE = 50;
const RECENT_BUILDS_SHOWN = 15;

export default async function WorkspacesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const workspacesRes = await backendFetch("/workspaces");
  const workspaces: Workspace[] = workspacesRes.ok ? await workspacesRes.json() : [];
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  const [statuses, buildLists] = await Promise.all([
    Promise.all(
      workspaces.map(async (w) => {
        const res = await backendFetch(`/workspaces/${w.id}/buildfarm/status`);
        return res.ok ? ((await res.json()) as BuildfarmInstance | null) : null;
      }),
    ),
    Promise.all(
      workspaces.map(async (w) => {
        const res = await backendFetch(`/workspaces/${w.id}/builds?limit=${BUILDS_PER_WORKSPACE}`);
        return res.ok ? ((await res.json()) as BuildSummary[]) : [];
      }),
    ),
  ]);

  const allBuilds = buildLists.flat();
  const kpis = computeKpis(allBuilds);
  const recentBuilds = [...allBuilds]
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, RECENT_BUILDS_SHOWN);
  const workspaceNameById = new Map(workspaces.map((w) => [w.id, w.name]));
  const activeCount = statuses.filter((s) => s?.status === "running").length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} />

      <div className="flex w-full flex-col gap-8 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {workspaces.length === 0
              ? "Create your first workspace from the menu in the top right to design and provision a Buildfarm."
              : `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} · ${activeCount} active Buildfarm${activeCount === 1 ? "" : "s"}.`}
          </p>
        </div>

        {workspaces.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Workspaces" value={String(workspaces.length)} />
            <StatTile label="Active Buildfarms" value={String(activeCount)} dotColorVar="var(--status-good)" />
            <StatTile label="Builds loaded" value={String(kpis.total)} />
            <StatTile
              label="Success rate"
              value={kpis.successRate === null ? "—" : `${kpis.successRate}%`}
              sub={`${kpis.passed} passed, ${kpis.failed} failed`}
            />
            <StatTile label="Avg build time" value={formatDuration(kpis.avgDurationMs)} />
            <StatTile
              label="Remote hit share"
              value={kpis.remoteHitShare === null ? "—" : `${kpis.remoteHitShare}%`}
              sub={`${kpis.remoteHits} remote hits / ${kpis.actionsRun} actions`}
            />
          </div>
        )}

        <div className="rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200">
            Workspaces
          </h2>
          {workspaces.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No workspaces yet. Each one gets its own Buildfarm you design and provision.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/5">
              {workspaces.map((workspace, i) => {
                const instance = statuses[i];
                return (
                  <li key={workspace.id}>
                    <Link
                      href={`/workspaces/${workspace.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-black/[.02] dark:hover:bg-white/[.03]"
                    >
                      <div className="min-w-0">
                        <span className="block truncate font-medium text-black dark:text-zinc-50">
                          {workspace.name}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {workspace.memberIds.length} member
                          {workspace.memberIds.length === 1 ? "" : "s"} · created{" "}
                          {new Date(workspace.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {instance && (
                          <span className="hidden rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500 sm:inline dark:bg-white/[.07] dark:text-zinc-400">
                            {instance.provider}
                          </span>
                        )}
                        <span
                          className={`text-xs font-medium ${instanceStatusColor(instance?.status ?? "none")}`}
                        >
                          {instance ? INSTANCE_STATUS_LABEL[instance.status] : "Not provisioned"}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {recentBuilds.length > 0 && (
          <div className="rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200">
              Recent builds
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                    <th className="px-4 py-2 font-medium">Workspace</th>
                    <th className="px-4 py-2 font-medium">Command</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Duration</th>
                    <th className="px-4 py-2 font-medium">Started</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {recentBuilds.map((build) => (
                    <tr
                      key={build.id}
                      className="border-t border-black/5 text-zinc-700 dark:border-white/5 dark:text-zinc-300"
                    >
                      <td className="px-4 py-2 font-medium">
                        {workspaceNameById.get(build.workspaceId) ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{build.command}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={build.status} />
                      </td>
                      <td className="px-4 py-2">
                        {build.status === "running" ? "—" : formatDuration(build.totalDurationMs)}
                      </td>
                      <td className="px-4 py-2" suppressHydrationWarning>
                        {new Date(build.startTime).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/workspaces/${build.workspaceId}/builds/${build.id}`}
                          className="text-xs whitespace-nowrap text-zinc-500 hover:underline dark:text-zinc-400"
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
        )}
      </div>
    </div>
  );
}
