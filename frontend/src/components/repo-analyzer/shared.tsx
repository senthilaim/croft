"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { AnalysisDiagnosis } from "@croft/shared-types";

export const field =
  "h-9 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100";
export const card =
  "rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900";

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className={`${card} p-5`}>
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

export function LogPanel({ text, failed }: { text: string | null; failed: boolean }) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div
      className={`mt-3 overflow-hidden rounded-lg border ${
        failed ? "border-red-200 dark:border-red-900/40" : "border-black/10 dark:border-white/10"
      }`}
    >
      <div
        className={`flex items-center justify-between border-b px-3 py-1.5 text-xs font-medium ${
          failed
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300"
            : "border-black/10 bg-black/[.03] text-zinc-600 dark:border-white/10 dark:bg-white/[.04] dark:text-zinc-300"
        }`}
      >
        {failed ? "Sandbox log (why it failed)" : "Sandbox log — live"}
      </div>
      <pre
        ref={ref}
        className="max-h-56 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-zinc-700 dark:text-zinc-300"
      >
        {text || "Waiting for output…"}
      </pre>
    </div>
  );
}

/** Shared block for both a failed run and a succeeded run that found nothing -- title, plain-
 * language summary, and concrete next steps when the failure matched a known class (see
 * backend/src/repo-analysis/analysis-diagnostics.ts), the raw sandbox log always underneath as
 * evidence, and a fallback to the plain error message when nothing matched. */
export function DiagnosisBlock({
  diagnosis,
  fallbackMessage,
  logTail,
}: {
  diagnosis: AnalysisDiagnosis | null;
  fallbackMessage: string | null;
  logTail: string | null;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/30">
      {diagnosis ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">{diagnosis.title}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                diagnosis.selfServiceable
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {diagnosis.selfServiceable ? "Something to fix in your repo" : "Current Croft limitation"}
            </span>
          </div>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{diagnosis.summary}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-red-700 dark:text-red-300">
            {diagnosis.recommendedSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </>
      ) : (
        fallbackMessage && <p className="text-sm text-red-700 dark:text-red-300">{fallbackMessage}</p>
      )}
      <LogPanel text={logTail} failed />
    </div>
  );
}

export const categoryLabel: Record<string, string> = {
  changed: "Changed",
  new: "New (cold build)",
  unconditional: "Always runs",
  other: "Other",
};

/** Small empty-state card used when a tool's precondition isn't met yet (e.g. "analyze this repo
 * first", "no running Buildfarm") -- same visual shape, just a different message/link. */
export function GateCard({ message, linkHref, linkLabel }: { message: string; linkHref: string; linkLabel: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-black/[.02] px-3 py-2 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400">
      {message}{" "}
      <Link href={linkHref} className="font-medium text-brand underline">
        {linkLabel}
      </Link>
    </div>
  );
}
