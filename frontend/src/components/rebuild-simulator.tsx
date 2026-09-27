"use client";

import { useState } from "react";
import type { RebuildSimulationResult } from "@croft/shared-types";
import { useWorkspaceSocket } from "@/lib/use-workspace-socket";
import { Step, LogPanel, DiagnosisBlock, categoryLabel, field } from "./repo-analyzer/shared";

export function RebuildSimulator({
  workspaceId,
  initialSimulation,
}: {
  workspaceId: string;
  initialSimulation: RebuildSimulationResult | null;
}) {
  const [simulation, setSimulation] = useState(initialSimulation);
  const [target, setTarget] = useState("");
  const [filePath, setFilePath] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const running = simulation?.status === "running";

  useWorkspaceSocket(workspaceId, {
    rebuildSimulation: (next) => setSimulation(next as RebuildSimulationResult),
  });

  async function handleSimulate(e: React.FormEvent) {
    e.preventDefault();
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/repo-analysis/simulate-rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, filePath }),
      });
      const body = await res.json();
      if (!res.ok) {
        setStartError(body?.message ?? "Could not start the rebuild simulation.");
        return;
      }
      setSimulation(body);
    } catch {
      setStartError("Could not reach the server.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Step n={1} title='"Why did this rebuild?"'>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Builds a target once, makes a one-line edit to a file you choose, builds it again, and shows exactly
        which actions re-ran and why — using Bazel&apos;s own <code>--explain</code> output.
      </p>
      <form onSubmit={handleSimulate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
        <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          File to edit (repo-relative)
          <input
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="lib/core.cc"
            className={`${field} font-mono`}
            required
          />
        </label>
        <button
          type="submit"
          disabled={starting || running}
          className="h-9 shrink-0 rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {running ? "Simulating…" : "Simulate rebuild"}
        </button>
      </form>
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        This runs a real build of the target you choose, inside the same hardened sandbox — it can fail for
        reasons specific to your build&apos;s toolchain requirements, not just for the reasons this tool is
        designed to explain.
      </div>
      {startError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{startError}</p>}

      {running && <LogPanel text={simulation?.logTail ?? null} failed={false} />}
      {simulation?.status === "failed" && (
        <div className="mt-3">
          <DiagnosisBlock
            diagnosis={simulation.diagnosis}
            fallbackMessage={simulation.errorMessage}
            logTail={simulation.logTail}
          />
        </div>
      )}
      {simulation?.status === "succeeded" && (
        <div className="mt-4">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {simulation.totalActionsRebuilt} of {simulation.baselineTotalActions} actions rebuilt for{" "}
            <span className="font-mono">{simulation.target}</span> after editing{" "}
            <span className="font-mono">{simulation.filePath}</span>
          </p>
          {simulation.rebuiltActions.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-black/[.03] text-zinc-600 dark:bg-white/[.04] dark:text-zinc-300">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Action</th>
                    <th className="px-3 py-1.5 font-medium">Category</th>
                    <th className="px-3 py-1.5 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {simulation.rebuiltActions.map((a, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-mono text-zinc-800 dark:text-zinc-200">{a.description}</td>
                      <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">
                        {categoryLabel[a.category] ?? a.category}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Nothing rebuilt — the edit to {simulation.filePath} didn&apos;t affect {simulation.target}.
            </p>
          )}
        </div>
      )}
    </Step>
  );
}
