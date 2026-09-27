"use client";

import { useState } from "react";
import type { BuildfarmInstanceStatus, CacheCheckResult } from "@croft/shared-types";
import { useWorkspaceSocket } from "@/lib/use-workspace-socket";
import { GateCard, Step, LogPanel, DiagnosisBlock, field, card } from "./repo-analyzer/shared";

export function CacheChecker({
  workspaceId,
  buildfarmStatus,
  initialCacheCheck,
}: {
  workspaceId: string;
  buildfarmStatus: BuildfarmInstanceStatus | null;
  initialCacheCheck: CacheCheckResult | null;
}) {
  const [cacheCheck, setCacheCheck] = useState(initialCacheCheck);
  const [target, setTarget] = useState("");
  const [consented, setConsented] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const running = cacheCheck?.status === "running";
  const buildfarmRunning = buildfarmStatus === "running";

  useWorkspaceSocket(workspaceId, {
    cacheCheck: (next) => setCacheCheck(next as CacheCheckResult),
  });

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/repo-analysis/cache-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const body = await res.json();
      if (!res.ok) {
        setStartError(body?.message ?? "Could not start the cache check.");
        return;
      }
      setCacheCheck(body);
    } catch {
      setStartError("Could not reach the server.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Step n={1} title="Does my remote cache actually work?">
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Builds a target twice against this workspace&apos;s own, real, running Buildfarm&apos;s remote cache —
        each build starts with a completely fresh local cache, so any reported hit is genuinely served by
        your Buildfarm, not the sandbox&apos;s own disk.
      </p>

      <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
        <p className="font-medium">This connects the sandbox to your infrastructure.</p>
        <p className="mt-1">
          This check intentionally breaks the sandbox&apos;s usual isolation so it can reach your
          workspace&apos;s real, running Buildfarm over the network and write real entries into its cache
          storage. It never dispatches remote execution — only cache reads and writes.
        </p>
      </div>

      {!buildfarmRunning ? (
        <GateCard
          message="This workspace has no running Buildfarm to check the cache against."
          linkHref={`/workspaces/${workspaceId}/designer`}
          linkLabel="Provision one first →"
        />
      ) : (
        <>
          <label className="mb-3 flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5"
            />
            I understand this connects the analysis sandbox to my running Buildfarm.
          </label>
          <form onSubmit={handleCheck} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Target
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="//lib:core"
                className={`${field} font-mono`}
                required
              />
            </label>
            <button
              type="submit"
              disabled={starting || running || !consented}
              className="h-9 shrink-0 rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              {running ? "Checking…" : "Check remote cache"}
            </button>
          </form>
        </>
      )}
      {startError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{startError}</p>}

      {running && <LogPanel text={cacheCheck?.logTail ?? null} failed={false} />}
      {cacheCheck?.status === "failed" && (
        <div className="mt-3">
          <DiagnosisBlock
            diagnosis={cacheCheck.diagnosis}
            fallbackMessage={cacheCheck.errorMessage}
            logTail={cacheCheck.logTail}
          />
        </div>
      )}
      {cacheCheck?.status === "succeeded" && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={`${card} px-4 py-3`}>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Existing cache (read check)</p>
            <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {cacheCheck.readCheck.remoteCacheHits}/{cacheCheck.readCheck.cacheableActions}
              <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                actions hit ({cacheCheck.readCheck.hitRatePercent}%)
              </span>
            </p>
          </div>
          <div className={`${card} px-4 py-3`}>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">After this check populated it (round-trip)</p>
            <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {cacheCheck.roundTripCheck.remoteCacheHits}/{cacheCheck.roundTripCheck.cacheableActions}
              <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                actions hit ({cacheCheck.roundTripCheck.hitRatePercent}%)
              </span>
            </p>
          </div>
        </div>
      )}
    </Step>
  );
}
