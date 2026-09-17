import Link from "next/link";
import { redirect } from "next/navigation";
import type { Workspace } from "@bazel-bootstrap/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";

export default async function WorkspacesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const res = await backendFetch("/workspaces");
  const workspaces: Workspace[] = res.ok ? await res.json() : [];
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} />

      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {workspaces.length === 0
              ? "Create your first workspace to design and provision a Buildfarm."
              : `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} · pick one up, or start a new one.`}
          </p>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Create a workspace
          </h2>
          <div className="mt-3">
            <CreateWorkspaceForm />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {workspaces.length === 0 ? (
            <div className="rounded-xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No workspaces yet. Each one gets its own Buildfarm you design and provision.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <Link
                    href={`/workspaces/${workspace.id}`}
                    className="flex flex-col gap-2 rounded-xl border border-black/10 bg-white p-4 transition-colors hover:border-black/20 hover:bg-black/[.02] dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20 dark:hover:bg-white/[.03]"
                  >
                    <span className="font-medium text-black dark:text-zinc-50">
                      {workspace.name}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {workspace.memberIds.length} member
                      {workspace.memberIds.length === 1 ? "" : "s"} · created{" "}
                      {new Date(workspace.createdAt).toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
