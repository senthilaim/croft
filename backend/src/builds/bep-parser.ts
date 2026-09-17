export interface BuildEventId {
  targetCompleted?: { label?: string };
}

export interface BuildMetricsJson {
  actionsCreated?: number;
  actionsExecuted?: number;
  remoteCacheHits?: number;
}

export interface BuildEventJson {
  id?: BuildEventId;
  started?: { uuid?: string; command?: string; startTime?: string };
  completed?: { success?: boolean };
  finished?: { finishTime?: string; exitCode?: { code?: number }; errorMessage?: string };
  buildMetrics?: BuildMetricsJson;
}

/** proto3 JSON omits int32 fields at their zero value, so a successful build's
 * exitCode.code (0) is simply absent from the payload rather than present as 0. */
export function isSuccessExitCode(exitCode: { code?: number } | undefined): boolean {
  return (exitCode?.code ?? 0) === 0;
}
