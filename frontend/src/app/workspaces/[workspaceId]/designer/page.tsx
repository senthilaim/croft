import { notFound } from "next/navigation";
import Link from "next/link";
import type { BuildfarmConfig, BuildfarmInstance } from "@croft/shared-types";
import { backendFetch } from "@/lib/session";
import { BuildfarmCanvas } from "@/components/designer/buildfarm-canvas";

export default async function DesignerPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
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
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-black/10 px-6 dark:border-white/10">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Workspace
        </Link>
        <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Buildfarm designer</h1>
      </header>
      <BuildfarmCanvas workspaceId={workspaceId} initialConfig={config} initialInstance={instance} />
    </div>
  );
}
