export interface BuildEventId {
  targetCompleted?: { label?: string };
}

export interface BuildMetricsJson {
  actionsCreated?: number;
  actionsExecuted?: number;
  remoteCacheHits?: number;
}

export interface BuildActionJson {
  label?: string | null;
  mnemonic?: string;
  exitCode?: number;
  commandLine?: string[];
  primaryOutputPath?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  stdout?: string | null;
  stderr?: string | null;
}

export interface WaterfallSpanJson {
  name?: string;
  category?: string;
  lane?: string;
  startMs?: number;
  durationMs?: number;
}

export interface TestSummaryJson {
  label?: string;
  status?: string;
  runCount?: number;
  totalDurationMs?: number;
}

export interface BuildArtifactJson {
  targetLabel?: string;
  name?: string;
  uri?: string;
  sizeBytes?: number;
}

export interface BuildEventJson {
  /** Bazel's own build UUID (StreamId.invocation_id), present on every relayed event -- the
   * correlation key used instead of "most recently started build in this workspace". */
  invocationId?: string;
  id?: BuildEventId;
  started?: { uuid?: string; command?: string; startTime?: string };
  completed?: { success?: boolean };
  finished?: {
    finishTime?: string;
    exitCode?: { code?: number };
    errorMessage?: string;
    consoleLog?: string;
  };
  /** Console output that arrived after `finished` (Bazel prints load/analysis errors late). */
  consoleUpdate?: { consoleLog?: string | null; errorMessage?: string | null };
  buildMetrics?: BuildMetricsJson;
  action?: BuildActionJson;
  waterfall?: WaterfallSpanJson[];
  testSummary?: TestSummaryJson;
  artifacts?: BuildArtifactJson[];
}

/** proto3 JSON omits int32 fields at their zero value, so a successful build's
 * exitCode.code (0) is simply absent from the payload rather than present as 0. */
export function isSuccessExitCode(exitCode: { code?: number } | undefined): boolean {
  return (exitCode?.code ?? 0) === 0;
}
