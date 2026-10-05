import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import type { BuildfarmConfig, BuildfarmInstance } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import Link from "next/link";
import { AwsArchitectureDiagram } from "@/components/designer/aws-architecture-diagram";

export default async function AwsArchitecturePage({
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
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-2 dark:border-white/10">
        <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">AWS architecture</h1>
        <Link
          href={`/workspaces/${workspaceId}/designer`}
          className="text-xs font-medium text-brand hover:underline"
        >
          ← Back to Designer
        </Link>
      </div>
      {config.provider === "aws" ? (
        <div className="flex-1">
          <AwsArchitectureDiagram config={config} topology={instance?.awsTopology} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Switch this workspace to AWS in the Designer to see its AWS architecture.
          </p>
        </div>
      )}
    </div>
  );
}
