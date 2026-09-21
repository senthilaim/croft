import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { BuildfarmInstance, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWizard } from "@/components/connect-wizard";

export default async function ConnectPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const [workspaceRes, instanceRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/buildfarm/status`),
  ]);
  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  const workspace: Workspace | null = workspaceRes.ok ? await workspaceRes.json() : null;
  const instance: BuildfarmInstance | null = instanceRes.ok ? await instanceRes.json() : null;
  const running = instance?.status === "running";
  const requestHost = (await headers()).get("host") ?? "localhost";
  const defaultHost = requestHost.replace(/:\d+$/, "") || "localhost";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={workspace ? `${workspace.name} / Connect a repo` : undefined} />

      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8 lg:px-10">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Connect an existing repo</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Point your CI at this workspace&apos;s Buildfarm in four steps. Your repo gets remote
            execution and caching, and every build shows up live in Build analytics.
          </p>
        </div>

        {running ? (
          <ConnectWizard workspaceId={workspaceId} defaultHost={defaultHost} />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This workspace doesn&apos;t have a running Buildfarm yet.{" "}
            <Link
              href={`/workspaces/${workspaceId}/designer`}
              className="font-medium text-black underline dark:text-zinc-50"
            >
              Open the designer
            </Link>{" "}
            and click &ldquo;Submit Setup&rdquo; first.
          </p>
        )}
      </div>
    </div>
  );
}
