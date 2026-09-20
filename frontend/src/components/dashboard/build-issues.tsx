import type { BuildIssue } from "@croft/shared-types";
import { CopyLocation } from "./copy-location";

function locationOf(issue: BuildIssue): string | null {
  if (!issue.file) return null;
  const parts = [issue.file, issue.line, issue.column].filter((p) => p !== null && p !== undefined);
  return parts.join(":");
}

export function BuildIssues({ issues }: { issues: BuildIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-white shadow-sm dark:border-red-900/40 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-red-200 px-4 py-3 dark:border-red-900/40">
        <h2 className="text-sm font-medium text-red-700 dark:text-red-400">
          What went wrong ({issues.length})
        </h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Located from Bazel&apos;s output, with a suggested fix
        </span>
      </div>

      <ol className="divide-y divide-black/5 dark:divide-white/5">
        {issues.map((issue, index) => {
          const location = locationOf(issue);
          return (
            <li key={`${location}-${index}`} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--status-critical)]" />
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{issue.title}</h3>
                <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-white/[.08] dark:text-zinc-300">
                  {issue.category}
                </span>
              </div>

              {location && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/[.04] px-3 py-2 dark:bg-white/[.05]">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">File</span>
                  <code className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-900 dark:text-zinc-50">
                    {location}
                  </code>
                  <CopyLocation text={location} />
                </div>
              )}

              <div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                  {[issue.message, ...issue.context].join("\n")}
                </pre>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/30">
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  Recommended fix
                </p>
                <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-100">
                  {issue.recommendation.summary}
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-emerald-900 dark:text-emerald-200">
                  {issue.recommendation.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
