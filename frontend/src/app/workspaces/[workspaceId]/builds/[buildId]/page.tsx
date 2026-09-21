import { BuildIssues } from "@/components/dashboard/build-issues";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Build } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { BuildWaterfall } from "@/components/dashboard/build-waterfall";
import { BuildActionsTable } from "@/components/dashboard/build-actions-table";
import { BuildArtifactsTable } from "@/components/dashboard/build-artifacts-table";
import { DownloadButton } from "@/components/dashboard/download-button";

export default async function BuildDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; buildId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const { workspaceId, buildId } = await params;
  const buildRes = await backendFetch(`/workspaces/${workspaceId}/builds/${buildId}`);
  if (!buildRes.ok) notFound();
  const build: Build = await buildRes.json();
  const execFormatError = [build.errorMessage, ...build.actions.map((a) => a.stderr)].some(
    (text) => !!text && /Exec format error|cannot execute binary file/i.test(text),
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={`Build ${build.invocationId.slice(0, 8)}`} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <Link
          href={`/workspaces/${workspaceId}/dashboard`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Build analytics
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-xl font-semibold break-all text-black dark:text-zinc-50">
              {build.command}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              <StatusBadge status={build.status} />
              {build.demo && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  Demo data
                </span>
              )}
              <span>{new Date(build.startTime).toLocaleString()}</span>
              <span>
                {build.status === "running" ? "—" : `${(build.totalDurationMs / 1000).toFixed(1)}s`}
              </span>
            </div>
          </div>
          {build.consoleLog && (
            <DownloadButton
              content={build.consoleLog}
              filename={`build-${build.invocationId}-console.log`}
              label="Download console log"
            />
          )}
        </div>

        <BuildIssues issues={build.issues ?? []} workspaceId={workspaceId} />

        {build.errorMessage && (build.issues ?? []).length === 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
            <p className="mb-1 font-medium">Failure reason</p>
            <p className="whitespace-pre-wrap font-mono text-xs">{build.errorMessage}</p>
          </div>
        )}

        {execFormatError && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="mb-1 font-medium">This looks like an execution-platform mismatch</p>
            <p className="text-xs">
              A tool built for a different OS was sent to your Linux worker (&ldquo;Exec format
              error&rdquo;). Bazel picks toolchains for the <em>execution</em> platform, which
              defaults to your own machine. See{" "}
              <Link
                href={`/workspaces/${workspaceId}/sample-project#your-project`}
                className="font-medium underline"
              >
                Use your own project
              </Link>{" "}
              for the platform to declare and the toolchain change your project needs.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Timing waterfall
          </h2>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Every action Bazel ran during this build, from its own trace profile — hover a bar for
            detail.
          </p>
          <BuildWaterfall spans={build.waterfall} />
        </div>

        <div className="rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200">
            Failed actions
          </h2>
          <BuildActionsTable actions={build.actions} />
        </div>

        <div className="rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="border-b border-black/10 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-white/10 dark:text-zinc-200">
            Build outputs
          </h2>
          <BuildArtifactsTable workspaceId={workspaceId} buildId={buildId} artifacts={build.artifacts} />
        </div>
      </div>
    </div>
  );
}
