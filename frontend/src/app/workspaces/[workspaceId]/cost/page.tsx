import { notFound, redirect } from "next/navigation";
import type { Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { CostEstimator } from "@/components/cost-estimator";

export default async function CostPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const workspaceRes = await backendFetch(`/workspaces/${workspaceId}`);
  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  const workspace: Workspace | null = workspaceRes.ok ? await workspaceRes.json() : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={workspace ? `${workspace.name} / Cost estimate` : undefined} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Infrastructure cost estimate</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            What this workspace&apos;s Buildfarm design would cost to run on your own machine, AWS, Google Cloud,
            Azure or your own servers. It reads your saved design, so it works before you provision anything.
          </p>
        </div>
        <CostEstimator workspaceId={workspaceId} />
      </div>
    </div>
  );
}
