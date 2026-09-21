"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { BuildSummary, CiProvider, ConnectKit } from "@croft/shared-types";
import { CopyBlock } from "./copy-block";

const PROVIDERS: Array<{ key: CiProvider; label: string }> = [
  { key: "github", label: "GitHub Actions" },
  { key: "gitlab", label: "GitLab CI" },
  { key: "jenkins", label: "Jenkins" },
];

const field =
  "h-9 rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <h2 className="mb-3 flex items-center gap-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs text-white">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ConnectWizard({ workspaceId, defaultHost }: { workspaceId: string; defaultHost: string }) {
  const [host, setHost] = useState(defaultHost);
  const [provider, setProvider] = useState<CiProvider>("github");
  const [runner, setRunner] = useState<"self-hosted" | "hosted">("self-hosted");
  const [kit, setKit] = useState<ConnectKit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [seen, setSeen] = useState<BuildSummary | null>(null);
  const baseline = useRef<Set<string> | null>(null);
  const seenId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const qs = new URLSearchParams({ host, provider, runner });
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/sample-project/connect-kit?${qs}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          setKit(await res.json());
          setError(null);
        } else {
          const body = await res.json().catch(() => null);
          setKit(null);
          setError(body?.message ?? "Could not generate the files.");
        }
      } catch {
        /* superseded by a newer request */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workspaceId, host, provider, runner]);

  // Live check: the first invocation that arrives after this page opened proves the connection.
  useEffect(() => {
    const socket: Socket = io({ path: "/ws", addTrailingSlash: false, transports: ["websocket"] });
    socket.on("connect", () => socket.emit("subscribe", { workspaceId }));
    socket.on("builds", (builds: BuildSummary[]) => {
      if (baseline.current === null) {
        baseline.current = new Set(builds.map((b) => b.id));
        return;
      }
      const fresh = builds.find((b) => !baseline.current!.has(b.id));
      if (fresh) {
        seenId.current = fresh.id;
        setSeen(fresh);
      } else if (seenId.current) {
        const current = builds.find((b) => b.id === seenId.current);
        if (current) setSeen(current);
      }
    });
    return () => {
      socket.emit("unsubscribe", { workspaceId });
      socket.disconnect();
    };
  }, [workspaceId]);

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Step n={1} title="Where can your CI reach this infrastructure?">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Host name or IP
            <input value={host} onChange={(e) => setHost(e.target.value.trim())} className={`${field} w-72`} />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          The address your CI runners use to reach the machine running Croft&apos;s Buildfarm. It is
          written into the generated files.
        </p>
      </Step>

      <Step n={2} title="Pick your CI system">
        <div className="flex flex-wrap items-center gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setProvider(p.key)}
              aria-pressed={provider === p.key}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                provider === p.key
                  ? "border-brand bg-brand-soft text-brand dark:text-zinc-50"
                  : "border-black/10 text-zinc-600 hover:bg-black/[.04] dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[.06]"
              }`}
            >
              {p.label}
            </button>
          ))}
          {provider === "github" && (
            <select
              value={runner}
              onChange={(e) => setRunner(e.target.value as "self-hosted" | "hosted")}
              className={`${field} ml-2`}
              aria-label="Runner type"
            >
              <option value="self-hosted">Self-hosted runner</option>
              <option value="hosted">GitHub-hosted runner</option>
            </select>
          )}
        </div>
      </Step>

      <Step n={3} title="Add these files to your repository">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {kit && (
          <div className="flex flex-col gap-4">
            {kit.warnings.length > 0 && (
              <ul className="flex flex-col gap-2">
                {kit.warnings.map((w) => (
                  <li
                    key={w}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    {w}
                  </li>
                ))}
              </ul>
            )}
            {kit.files.map((f) => (
              <div key={f.path} className="flex flex-col gap-1.5">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{f.description}</p>
                <CopyBlock title={f.path} text={f.content} />
              </div>
            ))}
          </div>
        )}
      </Step>

      <Step n={4} title="Verify the connection">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Run this from a checkout of your repo (or let your CI run after you commit the files):
        </p>
        <div className="mt-2">
          <CopyBlock title="terminal" text={kit?.verifyCommand ?? "bazel build //... --config=croft"} />
        </div>
        <div
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            seen
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "bg-black/[.04] text-zinc-600 dark:bg-white/[.05] dark:text-zinc-300"
          }`}
          role="status"
        >
          <span
            className={`h-2 w-2 rounded-full ${seen ? "bg-green-500" : "animate-pulse bg-amber-500"}`}
            aria-hidden
          />
          {seen
            ? `Connected — received a ${seen.command} invocation (${seen.status}).`
            : "Waiting for your first build…"}
        </div>
      </Step>
    </div>
  );
}
