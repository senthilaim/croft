import Link from "next/link";
import { redirect } from "next/navigation";
import type { BuildfarmInstance, Workspace } from "@bazel-bootstrap/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";

export default async function SampleProjectPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const { workspaceId } = await params;
  const [workspaceRes, instanceRes] = await Promise.all([
    backendFetch(`/workspaces/${workspaceId}`),
    backendFetch(`/workspaces/${workspaceId}/buildfarm/status`),
  ]);
  const workspace: Workspace | null = workspaceRes.ok ? await workspaceRes.json() : null;
  const instance: BuildfarmInstance | null = instanceRes.ok ? await instanceRes.json() : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader
        user={user}
        breadcrumb={workspace ? `${workspace.name} / Sample project` : undefined}
      />

      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← {workspace?.name ?? "Workspace"}
        </Link>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Sample Bazel project
        </h1>

        {instance?.status === "running" ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Your Buildfarm is running at{" "}
              <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
                grpc://localhost:{instance.ports.grpc}
              </code>
              . Download a minimal Bazel project pre-configured to build against it.
            </p>
            <a
              href={`/api/workspaces/${workspaceId}/sample-project`}
              className="flex h-11 w-fit items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Download sample project
            </a>
            <div className="rounded-xl border border-black/10 bg-white p-4 text-sm shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="mb-2 font-medium text-zinc-800 dark:text-zinc-200">Quick start</p>
              <pre className="overflow-x-auto rounded bg-black/[.04] p-3 font-mono text-xs text-zinc-700 dark:bg-white/[.06] dark:text-zinc-300">
{`unzip buildfarm-sample-project.zip -d sample-project
cd sample-project
bazel build //:hello
cat bazel-bin/hello.txt`}
              </pre>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                That plain <code>bazel build</code> already streams live to the Build analytics
                dashboard — the downloaded <code>.bazelrc</code> wires it up, no extra command.
              </p>
            </div>
            <Link
              href={`/workspaces/${workspaceId}/dashboard`}
              className="text-sm font-medium text-blue-600 underline dark:text-blue-400"
            >
              Open Build analytics →
            </Link>
          </>
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
