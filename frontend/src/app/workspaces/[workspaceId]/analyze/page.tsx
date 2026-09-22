import { notFound, redirect } from "next/navigation";
import type { RepoAnalysisResult, RepoConnection, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { RepoAnalyzer } from "@/components/repo-analyzer";

export default async function AnalyzePage({
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
  if (connection) {
    const analysisRes = await backendFetch(`/workspaces/${workspaceId}/repo-analysis/result`);
    if (analysisRes.ok) analysis = await analysisRes.json();
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={workspace ? `${workspace.name} / Analyze` : undefined} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Analyze a repository</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Connect a GitHub repository and Croft clones it into an isolated sandbox, runs{" "}
            <code>bazel query</code>, and shows its target breakdown, external dependencies, package
            dependency graph, and a suggested Buildfarm sizing.
          </p>
        </div>
        <RepoAnalyzer workspaceId={workspaceId} initialConnection={connection} initialAnalysis={analysis} />
      </div>
    </div>
  );
}
