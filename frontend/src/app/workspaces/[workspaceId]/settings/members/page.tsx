import { notFound, redirect } from "next/navigation";
import type { Workspace, WorkspaceMember } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { MembersSettings } from "@/components/members-settings";

export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const [workspaceRes, membersRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/members`),
  ]);
  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  if (!workspaceRes.ok) throw new Error("Failed to load workspace");
  const workspace: Workspace = await workspaceRes.json();
  const members: WorkspaceMember[] = membersRes.ok ? await membersRes.json() : [];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={`${workspace.name} / Settings / Members`} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Members</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Who can access this workspace, and what they can do. Owner and admin can invite people who
            already have a Croft account; only the owner can change someone&apos;s role.
          </p>
        </div>
        <MembersSettings
          workspaceId={workspaceId}
          myUserId={user.id}
          myRole={workspace.myRole}
          initialMembers={members}
        />
      </div>
    </div>
  );
}
