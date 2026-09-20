import Link from "next/link";
import { redirect } from "next/navigation";
import type { BuildSummary, InfraStats, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const { workspaceId } = await params;
  const [workspaceRes, buildsRes, infraRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/builds`),
    backendFetch(`/workspaces/${workspaceId}/buildfarm/infra`),
  ]);
  const workspace: Workspace | null = workspaceRes.ok ? await workspaceRes.json() : null;
  const builds: BuildSummary[] = buildsRes.ok ? await buildsRes.json() : [];
  const infra: InfraStats = infraRes.ok ? await infraRes.json() : { containers: [] };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={workspace ? `${workspace.name} / Build analytics` : undefined} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← {workspace?.name ?? "Workspace"}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Build analytics</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Fed live — any <code>bazel build</code> from your sample project streams here as it
              happens, not just once it finishes.
            </p>
          </div>
          <div className="flex shrink-0 gap-4">
            <Link
              href={`/workspaces/${workspaceId}/dashboard/tests`}
              className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
            >
              Test grid →
            </Link>
            <Link
              href={`/workspaces/${workspaceId}/dashboard/trends`}
              className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
            >
              Historical trends →
            </Link>
          </div>
        </div>

        <LiveDashboard workspaceId={workspaceId} initialBuilds={builds} initialInfra={infra} />
      </div>
    </div>
  );
}
