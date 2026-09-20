import Link from "next/link";
import { redirect } from "next/navigation";
import type { BuildTrendPoint, InfraTrendSeries, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { TrendsView } from "@/components/dashboard/trends-view";

export default async function TrendsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const { workspaceId } = await params;
  const [workspaceRes, buildTrendsRes, infraTrendsRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/builds/trends?days=7`),
    backendFetch(`/workspaces/${workspaceId}/buildfarm/infra/trends?hours=168`),
  ]);
  const workspace: Workspace | null = workspaceRes.ok ? await workspaceRes.json() : null;
  const buildTrends: BuildTrendPoint[] = buildTrendsRes.ok ? await buildTrendsRes.json() : [];
  const infraTrends: InfraTrendSeries[] = infraTrendsRes.ok ? await infraTrendsRes.json() : [];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader
        user={user}
        breadcrumb={workspace ? `${workspace.name} / Historical trends` : undefined}
      />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <Link
          href={`/workspaces/${workspaceId}/dashboard`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Build analytics
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Historical trends
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Build time, remote cache hit rate, and executor CPU/memory usage over a selected
            range — a point-in-time query, not live.
          </p>
        </div>

        <TrendsView
          workspaceId={workspaceId}
          initialBuildTrends={buildTrends}
          initialInfraTrends={infraTrends}
        />
      </div>
    </div>
  );
}
