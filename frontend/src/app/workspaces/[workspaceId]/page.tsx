import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { BuildfarmInstance, Workspace } from "@croft/shared-types";
import { backendFetch, getCurrentUser } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";
import { BuildfarmStatusBadge } from "@/components/buildfarm-status-badge";

interface StepCard {
  href: string;
  title: string;
  description: string;
}

function PhaseSection({
  n,
  title,
  hint,
  cards,
}: {
  n: number;
  title: string;
  hint: string;
  cards: StepCard[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
          {n}
        </span>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      </div>
      <div className="grid gap-3 pl-9 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="flex flex-col gap-1 rounded-xl border border-black/10 bg-white p-4 transition-colors hover:border-black/20 hover:bg-black/[.02] dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20 dark:hover:bg-white/[.03]"
          >
            <span className="font-medium text-black dark:text-zinc-50">{card.title}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{card.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function WorkspaceDetailPage({
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

  if (workspaceRes.status === 404 || workspaceRes.status === 403) notFound();
  if (!workspaceRes.ok) throw new Error("Failed to load workspace");

  const workspace: Workspace = await workspaceRes.json();
  const instance: BuildfarmInstance | null = instanceRes.ok ? await instanceRes.json() : null;
  const base = `/workspaces/${workspace.id}`;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader user={user} breadcrumb={workspace.name} />

      <div className="flex w-full flex-col gap-8 px-4 py-8 sm:px-8 lg:px-10">
        <Link
          href="/workspaces"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← All workspaces
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              {workspace.name}
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {workspace.memberIds.length} member{workspace.memberIds.length === 1 ? "" : "s"} ·
              created {new Date(workspace.createdAt).toLocaleDateString()}
            </p>
          </div>
          {instance && <BuildfarmStatusBadge status={instance.status} />}
        </div>

        {/* Four phases, in the order a customer actually moves through them: understand what you
            need, design and price it, wire a project to it, then watch it run. */}
        <PhaseSection
          n={1}
          title="Evaluate"
          hint="Optional — skip straight to Design if you already know what you want"
          cards={[
            {
              href: `${base}/analyze`,
              title: "Analyze a repository",
              description: "Connect a GitHub repo and see what infra it actually needs",
            },
          ]}
        />

        <PhaseSection
          n={2}
          title="Design & estimate"
          hint="Build your Buildfarm and see what it costs"
          cards={[
            {
              href: `${base}/designer`,
              title: "Buildfarm designer",
              description: "Design and provision your infra",
            },
            {
              href: `${base}/cost`,
              title: "Cost estimate",
              description: "What this farm costs on AWS, GCP, Azure or your servers",
            },
          ]}
        />

        <PhaseSection
          n={3}
          title="Connect a project"
          hint="Try the sample project, or wire up your own"
          cards={[
            {
              href: `${base}/sample-project`,
              title: "Sample project",
              description: "Download a Bazel project wired to build",
            },
            {
              href: `${base}/connect`,
              title: "Connect a repo",
              description: "Generate CI files for your existing project",
            },
          ]}
        />

        <PhaseSection
          n={4}
          title="Watch it run"
          hint="Live status, failures, tests and trends"
          cards={[
            {
              href: `${base}/dashboard`,
              title: "Build analytics",
              description: "Live status, cache hits, failures",
            },
            {
              href: `${base}/files`,
              title: "Files",
              description: "Read-only view of what Croft generated for this workspace",
            },
          ]}
        />
      </div>
    </div>
  );
}
