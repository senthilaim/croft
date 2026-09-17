import type { BuildAction } from "@croft/shared-types";
import { DownloadButton } from "./download-button";

interface BuildActionsTableProps {
  actions: BuildAction[];
}

export function BuildActionsTable({ actions }: BuildActionsTableProps) {
  if (actions.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500">
        No failed actions — every action in this build either succeeded or wasn&apos;t captured.
      </p>
    );
  }

  return (
    <div className="divide-y divide-black/5 dark:divide-white/5">
      {actions.map((action, index) => (
        <div key={index} className="flex flex-col gap-2 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-mono text-xs font-medium text-red-600 dark:text-red-400">
                {action.mnemonic || "action"}
              </span>
              {action.label && (
                <span className="ml-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {action.label}
                </span>
              )}
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">exit code {action.exitCode}</span>
          </div>

          {action.primaryOutputPath && (
            <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {action.primaryOutputPath}
            </p>
          )}

          {action.commandLine.length > 0 && (
            <pre className="max-h-24 overflow-auto rounded-md bg-zinc-100 p-2 font-mono text-xs whitespace-pre-wrap text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {action.commandLine.join(" ")}
            </pre>
          )}

          <div className="flex gap-2">
            {action.stdout ? (
              <DownloadButton
                content={action.stdout}
                filename={`${action.mnemonic || "action"}-stdout.log`}
                label="Download stdout"
              />
            ) : (
              <span className="rounded-md border border-black/10 px-3 py-1.5 text-xs text-zinc-400 dark:border-white/10 dark:text-zinc-600">
                stdout unavailable
              </span>
            )}
            {action.stderr ? (
              <DownloadButton
                content={action.stderr}
                filename={`${action.mnemonic || "action"}-stderr.log`}
                label="Download stderr"
              />
            ) : (
              <span className="rounded-md border border-black/10 px-3 py-1.5 text-xs text-zinc-400 dark:border-white/10 dark:text-zinc-600">
                stderr unavailable
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
