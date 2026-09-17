import type { BuildArtifact } from "@croft/shared-types";

interface BuildArtifactsTableProps {
  workspaceId: string;
  buildId: string;
  artifacts: BuildArtifact[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BuildArtifactsTable({ workspaceId, buildId, artifacts }: BuildArtifactsTableProps) {
  if (artifacts.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500">
        No downloadable outputs — only each target&apos;s default output group is tracked, and
        directory outputs aren&apos;t downloadable this way.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-zinc-500 dark:text-zinc-400">
            <th className="px-4 py-2 font-medium">Target</th>
            <th className="px-4 py-2 font-medium">File</th>
            <th className="px-4 py-2 font-medium">Size</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact, index) => (
            <tr
              key={`${artifact.targetLabel}-${artifact.name}-${index}`}
              className="border-t border-black/5 text-zinc-700 dark:border-white/5 dark:text-zinc-300"
            >
              <td className="px-4 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {artifact.targetLabel}
              </td>
              <td className="px-4 py-2 font-mono text-xs">{artifact.name}</td>
              <td className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                {formatSize(artifact.sizeBytes)}
              </td>
              <td className="px-4 py-2 text-right">
                <a
                  href={`/api/workspaces/${workspaceId}/builds/${buildId}/artifacts/${index}/download`}
                  className="text-xs whitespace-nowrap text-zinc-500 hover:underline dark:text-zinc-400"
                >
                  Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
