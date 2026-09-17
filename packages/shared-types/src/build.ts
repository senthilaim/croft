export type BuildStatus = "running" | "success" | "failure";

export interface BuildTarget {
  label: string;
  status: BuildStatus;
  durationMs: number;
}

export interface Build {
  id: string;
  workspaceId: string;
  invocationId: string;
  command: string;
  startTime: string;
  endTime: string | null;
  status: BuildStatus;
  targets: BuildTarget[];
  totalDurationMs: number;
  /** Human-readable failure reason (analysis-phase abort description, or recent ERROR output). */
  errorMessage: string | null;
  actionsCreated: number;
  /** Total actions run; includes remote cache hits, excludes actions Bazel skipped entirely. */
  actionsExecuted: number;
  /** How many of actionsExecuted were satisfied by the Buildfarm remote cache. */
  remoteCacheHits: number;
}
