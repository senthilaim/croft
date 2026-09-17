export type BuildStatus = "running" | "success" | "failure";

export interface BuildTarget {
  label: string;
  status: BuildStatus;
  durationMs: number;
}

/** A single failed action's detail. Only failed actions are captured -- Bazel only emits this
 * event by default for failures, and that's also where per-action detail matters most. */
export interface BuildAction {
  label: string | null;
  mnemonic: string;
  exitCode: number;
  commandLine: string[];
  primaryOutputPath: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Best-effort local read of the action's captured output; null when unavailable (e.g. the
   * file was on a different machine, or has since been cleaned up). */
  stdout: string | null;
  stderr: string | null;
}

/** One span in the build's timing waterfall, sourced from Bazel's own JSON trace profile. */
export interface WaterfallSpan {
  name: string;
  category: string;
  lane: string;
  startMs: number;
  durationMs: number;
}

/** One output file from a target's "default" output group -- what plain `bazel build` produces,
 * not instrumentation/coverage output groups. Downloadable via
 * GET .../builds/:buildId/artifacts/:index/download; the internal CAS reference (bytestream://
 * URI) that download uses is deliberately not part of this public type. */
export interface BuildArtifact {
  targetLabel: string;
  name: string;
  sizeBytes: number;
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
  /** Failed actions, most recent first as they arrived. Empty on a successful build. */
  actions: BuildAction[];
  /** Timing spans from Bazel's JSON trace profile; empty when the profile couldn't be read. */
  waterfall: WaterfallSpan[];
  /** Full buffered console output, for download. Null until the build finishes. */
  consoleLog: string | null;
  /** Output files from each completed target's default output group. */
  artifacts: BuildArtifact[];
}

/** One day's build stats for a workspace, from GET /workspaces/:id/builds/trends. */
export interface BuildTrendPoint {
  date: string;
  buildCount: number;
  avgDurationMs: number;
  successRate: number;
  /** null when no actions executed that day (nothing to compute a rate from). */
  cacheHitRate: number | null;
}

/** Bazel's own aggregate result for a test target in one invocation (all its runs/shards/
 * attempts combined) -- REMOTE_FAILURE/FAILED_TO_BUILD/TOOL_HALTED_BEFORE_TESTING/NO_STATUS all
 * fold into "failed", since a test grid doesn't need to distinguish infra hiccups from failures. */
export type TestRunStatus = "passed" | "flaky" | "timeout" | "failed" | "incomplete" | "no_status";

export interface TestRunEntry {
  status: TestRunStatus;
  startTime: string;
  totalDurationMs: number;
  buildId: string;
}

/** One row of the test grid, from GET /workspaces/:id/tests. */
export interface TestGridRow {
  label: string;
  /** Newest first, capped to a recent window. */
  runs: TestRunEntry[];
  /** True when the window contains both a "passed" and a non-passed status -- the outcome
   * varies between separate invocations, not just within one (Bazel's own "flaky" status
   * already covers that narrower, single-invocation case). */
  isFlaky: boolean;
  lastStatus: TestRunStatus;
}
