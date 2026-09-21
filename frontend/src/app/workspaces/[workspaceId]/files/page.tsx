import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { FileContent, FileGroup, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { FileViewer } from "@/components/file-viewer";

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ group?: string; path?: string; line?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const [workspaceRes, groupsRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/files`),
  ]);
  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  const workspace: Workspace | null = workspaceRes.ok ? await workspaceRes.json() : null;
  const groups: FileGroup[] = groupsRes.ok ? await groupsRes.json() : [];

  const firstGroup = groups.find((g) => g.files.length > 0);
  const group = query.group ?? firstGroup?.id;
  const path = query.path ?? groups.find((g) => g.id === group)?.files[0]?.path;
  let file: FileContent | null = null;
  if (group && path) {
    const res = await backendFetch(
      `/workspaces/${workspaceId}/files/content?${new URLSearchParams({ group, path })}`,
    );
    if (res.ok) file = await res.json();
  }
  const line = Number.parseInt(query.line ?? "", 10);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={workspace ? `${workspace.name} / Files` : undefined} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Files</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            A read-only view of the files Croft generated for this workspace: what was deployed, the sample
            project, and the demo project when the demo is loaded. Your own repository stays in your editor.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <nav aria-label="Files" className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.id} className="rounded-xl border border-black/10 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <p className="px-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{g.label}</p>
                <p className="mb-2 px-2 text-xs text-zinc-500 dark:text-zinc-400">{g.description}</p>
                <ul className="flex flex-col">
                  {g.files.map((f) => {
                    const active = g.id === group && f.path === path;
                    return (
                      <li key={f.path}>
                        <Link
                          href={`/workspaces/${workspaceId}/files?${new URLSearchParams({ group: g.id, path: f.path })}`}
                          aria-current={active ? "page" : undefined}
                          className={`block truncate rounded-md px-2 py-1 font-mono text-xs ${
                            active
                              ? "bg-brand-soft text-brand dark:text-zinc-50"
                              : "text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                          }`}
                        >
                          {f.path}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {file ? (
            <FileViewer file={file} highlightLine={Number.isFinite(line) ? line : null} />
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Select a file to view it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
