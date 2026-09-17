import Link from "next/link";
import { redirect } from "next/navigation";
import type { TestGridRow, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { TestGrid } from "@/components/dashboard/test-grid";

export default async function TestGridPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const { workspaceId } = await params;
  const [workspaceRes, testsRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/tests`),
  ]);
  const workspace: Workspace | null = workspaceRes.ok ? await workspaceRes.json() : null;
  const rows: TestGridRow[] = testsRes.ok ? await testsRes.json() : [];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={workspace ? `${workspace.name} / Test grid` : undefined} />

      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <Link
          href={`/workspaces/${workspaceId}/dashboard`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Build analytics
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Test grid</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            One row per test target, one cell per recent <code>bazel test</code> invocation.
            Flaky rows — outcome varies between separate runs, not just within one — are surfaced
            first.
          </p>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <TestGrid workspaceId={workspaceId} rows={rows} />
        </div>
      </div>
    </div>
  );
}
