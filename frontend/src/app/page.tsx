import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Logo } from "@/components/layout/logo";

const FEATURES = [
  {
    title: "Design visually",
    description:
      "Drag Server, Worker, and Redis Backplane nodes onto a canvas and connect them. No YAML, no manual config.",
  },
  {
    title: "Provision instantly",
    description:
      "Submit Setup spins up a real Buildfarm cluster in Docker containers, scoped to your workspace.",
  },
  {
    title: "Build remotely",
    description:
      "Point any Bazel project at your workspace and watch actions execute on your provisioned worker.",
  },
  {
    title: "Watch it live",
    description:
      "Build status, failures with real reasons, cache hits, and container health — streaming as it happens.",
  },
];

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/workspaces");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      <header className="flex h-16 shrink-0 items-center justify-between px-6">
        <div className="flex items-center gap-2 font-semibold text-black dark:text-zinc-50">
          <Logo className="h-6 w-6" />
          Croft
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/signin"
            className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="flex h-9 items-center rounded-full bg-foreground px-4 font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 py-16 text-center sm:py-24">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance text-black sm:text-5xl dark:text-zinc-50">
          Croft — your own Bazel Buildfarm, on your own machine
        </h1>
        <p className="mt-5 max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Design a remote-execution cluster visually, provision it with one click, and watch every
          build stream live — no cloud account required.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/signup"
            className="flex h-11 items-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Get started
          </Link>
          <Link
            href="/signin"
            className="flex h-11 items-center rounded-full border border-black/10 px-6 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/10 dark:hover:bg-white/[.06]"
          >
            Sign in
          </Link>
        </div>

        <div className="mt-20 grid w-full max-w-4xl gap-4 text-left sm:grid-cols-2 sm:mt-24">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-900"
            >
              <h3 className="font-medium text-black dark:text-zinc-50">{feature.title}</h3>
              <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </main>

      <footer className="px-6 py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
        Runs entirely on your own machine — your workspaces and build data never leave it.
      </footer>
    </div>
  );
}
