import { notFound, redirect } from "next/navigation";
import type { CloudCredential, CloudCredentialSetupInfo, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { CloudCredentialsSettings } from "@/components/cloud-credentials-settings";

export default async function CloudSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const [workspaceRes, setupInfoRes, connectionRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/cloud-credentials/setup-info`),
    backendFetch(`/workspaces/${workspaceId}/cloud-credentials/connection`),
  ]);
  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  if (!workspaceRes.ok) throw new Error("Failed to load workspace");
  const workspace: Workspace = await workspaceRes.json();

  if (!setupInfoRes.ok) throw new Error("Failed to load cloud credential setup info");
  const setupInfo: CloudCredentialSetupInfo = await setupInfoRes.json();
  const connection: CloudCredential | null = connectionRes.ok ? await connectionRes.json() : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={`${workspace.name} / Settings / Cloud`} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Connect an AWS account to provision this workspace&apos;s Buildfarm on real infrastructure
            instead of local Docker.
          </p>
        </div>
        <SettingsTabs workspaceId={workspaceId} active="cloud" />
        <CloudCredentialsSettings
          workspaceId={workspaceId}
          setupInfo={setupInfo}
          initialConnection={connection}
        />
      </div>
    </div>
  );
}
