"use client";

import { useEffect, useRef } from "react";

interface ProvisionLogPanelProps {
  log: string | null;
  /** true while still polling (status === "provisioning") -- only affects the header text/spinner,
   * the log content itself is the same either way. */
  inProgress: boolean;
}

/** Live tail of the current AWS apply/destroy's Terraform output, polled from
 * GET .../buildfarm/log by BuildfarmCanvas while an instance is "provisioning". Stays visible
 * (showing the final output) after the operation settles, until the next Submit Setup/Teardown
 * clears it. */
export function ProvisionLogPanel({ log, inProgress }: ProvisionLogPanelProps) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white/95 shadow-lg dark:border-white/10 dark:bg-zinc-900/95">
      <div className="flex items-center gap-2 border-b border-black/10 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-white/10 dark:text-zinc-300">
        {inProgress && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
        )}
        {inProgress ? "Provisioning AWS infrastructure — live Terraform output" : "Terraform output"}
      </div>
      <pre
        ref={ref}
        className="max-h-48 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300"
      >
        {log || "Waiting for output…"}
      </pre>
    </div>
  );
}
