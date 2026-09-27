import { notFound, redirect } from "next/navigation";
import type { RebuildSimulationResult, RepoAnalysisResult, RepoConnection, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { GateCard } from "@/components/repo-analyzer/shared";
import { RebuildSimulator } from "@/components/rebuild-simulator";

export default async function RebuildSimulationPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const [workspaceRes, connectionRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/repo-analysis/connection`),
  ]);
  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  const workspace: Workspace | null = workspaceRes.ok ? await workspaceRes.json() : null;
  const connection: RepoConnection | null = connectionRes.ok ? await connectionRes.json() : null;

  let analysis: RepoAnalysisResult | null = null;
  let simulation: RebuildSimulationResult | null = null;
  if (connection) {
    const [analysisRes, simulationRes] = await Promise.all([
      backendFetch(`/workspaces/${workspaceId}/repo-analysis/result`),
      backendFetch(`/workspaces/${workspaceId}/repo-analysis/simulate-rebuild/result`),
    ]);
    if (analysisRes.ok) analysis = await analysisRes.json();
    if (simulationRes.ok) simulation = await simulationRes.json();
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader
        user={user}
        breadcrumb={workspace ? `${workspace.name} / Analyze / Why did this rebuild?` : undefined}
      />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">&quot;Why did this rebuild?&quot;</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Builds a target once, makes a one-line edit to a file you choose, builds it again, and shows exactly
            which actions re-ran and why — using Bazel&apos;s own <code>--explain</code> output.
          </p>
        </div>
        {!connection ? (
          <GateCard
            message="Connect a repository first."
            linkHref={`/workspaces/${workspaceId}/analyze`}
            linkLabel="Connect a repository →"
          />
        ) : analysis?.status !== "succeeded" ? (
          <GateCard
            message="This repository hasn't been analyzed yet."
            linkHref={`/workspaces/${workspaceId}/analyze`}
            linkLabel="Analyze it first →"
          />
        ) : (
          <RebuildSimulator workspaceId={workspaceId} initialSimulation={simulation} />
        )}
      </div>
    </div>
  );
}
