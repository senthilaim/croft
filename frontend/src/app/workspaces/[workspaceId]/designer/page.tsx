import { notFound } from "next/navigation";
import type { BuildfarmConfig, BuildfarmInstance } from "@croft/shared-types";
import { redirect } from "next/navigation";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { BuildfarmCanvas } from "@/components/designer/buildfarm-canvas";

export default async function DesignerPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const [configRes, instanceRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}/buildfarm-config`),
    backendFetch(`/workspaces/${workspaceId}/buildfarm/status`),
  ]);

  if (configRes.status === 404 || configRes.status === 403) notFound();
  if (!configRes.ok) throw new Error("Failed to load buildfarm configuration");

  const config: BuildfarmConfig = await configRes.json();
  const instance: BuildfarmInstance | null = instanceRes.ok ? await instanceRes.json() : null;

  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-black">
      <AppHeader user={user} />
      <BuildfarmCanvas workspaceId={workspaceId} initialConfig={config} initialInstance={instance} />
    </div>
  );
}
