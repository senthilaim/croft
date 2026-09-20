import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { BuildfarmInstance, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { BuildfarmStatusBadge } from "@/components/buildfarm-status-badge";

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const { workspaceId } = await params;
  const [workspaceRes, instanceRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/buildfarm/status`),
  ]);

  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  if (!workspaceRes.ok) throw new Error("Failed to load workspace");

  const workspace: Workspace = await workspaceRes.json();
  const instance: BuildfarmInstance | null = instanceRes.ok ? await instanceRes.json() : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={workspace.name} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <Link
          href="/workspaces"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← All workspaces
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              {workspace.name}
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {workspace.memberIds.length} member{workspace.memberIds.length === 1 ? "" : "s"} ·
              created {new Date(workspace.createdAt).toLocaleDateString()}
            </p>
          </div>
          {instance && <BuildfarmStatusBadge status={instance.status} />}
        </div>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <Link
            href={`/workspaces/${workspace.id}/designer`}
            className="flex flex-col gap-1 rounded-xl border border-black/10 bg-white p-4 transition-colors hover:border-black/20 hover:bg-black/[.02] dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20 dark:hover:bg-white/[.03]"
          >
            <span className="font-medium text-black dark:text-zinc-50">Buildfarm designer</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Design and provision your infra
            </span>
          </Link>
          <Link
            href={`/workspaces/${workspace.id}/dashboard`}
            className="flex flex-col gap-1 rounded-xl border border-black/10 bg-white p-4 transition-colors hover:border-black/20 hover:bg-black/[.02] dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20 dark:hover:bg-white/[.03]"
          >
            <span className="font-medium text-black dark:text-zinc-50">Build analytics</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Live status, cache hits, failures
            </span>
          </Link>
          <Link
            href={`/workspaces/${workspace.id}/sample-project`}
            className="flex flex-col gap-1 rounded-xl border border-black/10 bg-white p-4 transition-colors hover:border-black/20 hover:bg-black/[.02] dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20 dark:hover:bg-white/[.03]"
          >
            <span className="font-medium text-black dark:text-zinc-50">Sample project</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Download a Bazel project wired to build
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
