import { notFound, redirect } from "next/navigation";
import type {
  BuildfarmInstance,
  CacheCheckResult,
  RepoAnalysisResult,
  RepoConnection,
  Workspace,
} from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { GateCard } from "@/components/repo-analyzer/shared";
import { CacheChecker } from "@/components/cache-checker";

export default async function CacheCheckPage({
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
  let cacheCheck: CacheCheckResult | null = null;
  if (connection) {
    const [analysisRes, cacheCheckRes] = await Promise.all([
      backendFetch(`/workspaces/${workspaceId}/repo-analysis/result`),
      backendFetch(`/workspaces/${workspaceId}/repo-analysis/cache-check/result`),
    ]);
    if (analysisRes.ok) analysis = await analysisRes.json();
    if (cacheCheckRes.ok) cacheCheck = await cacheCheckRes.json();
  }

  const buildfarmRes = await backendFetch(`/workspaces/${workspaceId}/buildfarm/status`);
  const buildfarm: BuildfarmInstance | null = buildfarmRes.ok ? await buildfarmRes.json() : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader
        user={user}
        breadcrumb={workspace ? `${workspace.name} / Analyze / Cache check` : undefined}
      />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Does my remote cache actually work?</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Builds a target twice against this workspace&apos;s own, real, running Buildfarm&apos;s remote cache —
            each build starts with a completely fresh local cache, so any reported hit is genuinely served by
            your Buildfarm, not the sandbox&apos;s own disk.
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
          <CacheChecker
            workspaceId={workspaceId}
            buildfarmStatus={buildfarm?.status ?? null}
            initialCacheCheck={cacheCheck}
          />
        )}
      </div>
    </div>
  );
}
