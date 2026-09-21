"use client";

import { useState } from "react";

interface Props {
  workspaceId: string;
  hasDemo: boolean;
  hasBuilds: boolean;
}

export function DemoBanner({ workspaceId, hasDemo, hasBuilds }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/demo`, { method });
      if (!res.ok) setError("Something went wrong. Please try again.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (hasDemo) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <span>
          <strong>Demo data</strong> is included below (rows marked <em>Demo</em>). It is generated sample data,
          not your real builds.
        </span>
        <span className="flex items-center gap-3">
          {error && <span className="text-xs text-red-700 dark:text-red-300">{error}</span>}
          <button
            type="button"
            onClick={() => call("DELETE")}
            disabled={busy}
            className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-950"
          >
            {busy ? "Clearing…" : "Clear demo data"}
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
        hasBuilds
          ? "border-black/10 bg-white text-zinc-600 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300"
          : "border-brand/30 bg-brand-soft text-zinc-800 dark:text-zinc-100"
      }`}
    >
      <span>
        {hasBuilds
          ? "Want to see every chart with plenty of data?"
          : "No builds yet. Run a demo to explore every view before connecting a real repo."}{" "}
        <span className="text-zinc-500 dark:text-zinc-400">
          Generates about 40 sample builds: cache warm-up, failures with fixes, and a flaky test.
        </span>
      </span>
      <span className="flex items-center gap-3">
        {error && <span className="text-xs text-red-700 dark:text-red-300">{error}</span>}
        <button
          type="button"
          onClick={() => call("POST")}
          disabled={busy}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Generating…" : "Run demo"}
        </button>
      </span>
    </div>
  );
}
