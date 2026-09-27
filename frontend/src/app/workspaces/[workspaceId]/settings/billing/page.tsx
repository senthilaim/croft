import { notFound, redirect } from "next/navigation";
import type { BillingInfo, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { BillingSettings } from "@/components/billing-settings";

export default async function BillingSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { workspaceId } = await params;
  const { checkout } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const [workspaceRes, billingRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/billing`),
  ]);
  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  if (!workspaceRes.ok) throw new Error("Failed to load workspace");
  const workspace: Workspace = await workspaceRes.json();

  // billingRes is owner/admin-gated -- a member/viewer gets a 403 here, which is expected (they
  // simply don't see billing details), not an error state to surface.
  const billing: BillingInfo | null = billingRes.ok ? await billingRes.json() : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={`${workspace.name} / Settings / Billing`} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            This workspace&apos;s plan and member limit.
          </p>
        </div>
        <SettingsTabs workspaceId={workspaceId} active="billing" />
        {billing ? (
          <BillingSettings
            workspaceId={workspaceId}
            myRole={workspace.myRole}
            initialBilling={billing}
            checkoutResult={checkout === "success" || checkout === "cancelled" ? checkout : null}
          />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Only the workspace owner or an admin can view billing.
          </p>
        )}
      </div>
    </div>
  );
}
