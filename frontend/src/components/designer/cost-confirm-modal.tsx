"use client";

import type { CostEstimate } from "@croft/shared-types";

const money = (n: number | null) =>
  n === null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

interface CostConfirmModalProps {
  estimate: CostEstimate | null;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Mandatory checkpoint before an AWS /provision call -- real infrastructure with a real bill, so
 * this is the one confirmation in the app that can't be skipped or defaulted through. The estimate
 * shown is freshly recomputed server-side (CostController reads the just-saved design), not a
 * cached number from an earlier visit to the /cost page. */
export function CostConfirmModal({ estimate, loading, error, submitting, onConfirm, onCancel }: CostConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-black/10 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Confirm AWS provisioning</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This creates real infrastructure in your connected AWS account, billed by AWS directly to you.
        </p>

        {loading && <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Calculating estimate…</p>}
        {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {estimate && (
          <div className="mt-4 rounded-lg border border-black/10 bg-black/[.02] p-3 text-sm dark:border-white/10 dark:bg-white/[.03]">
            <p className="font-medium text-zinc-800 dark:text-zinc-200">
              Estimated cost: <span className="text-base">{money(estimate.totalMonthly)}/month</span>
            </p>
            {estimate.instance && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {estimate.instance.count} × {estimate.instance.type} ({estimate.instance.vcpu} vCPU,{" "}
                {estimate.instance.memGb} GB) at ${estimate.instance.hourlyEach}/hour
              </p>
            )}
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{estimate.notes[1]}</p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-black/[.03] disabled:opacity-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/[.05]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting || loading || !estimate}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {submitting ? "Provisioning…" : "Confirm & provision"}
          </button>
        </div>
      </div>
    </div>
  );
}
