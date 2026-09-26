import type { AnalysisDiagnosis } from "./repo-analysis.js";

export type CacheCheckStatus = "pending" | "running" | "succeeded" | "failed";

export interface CacheCheckAction {
  targetLabel: string;
  mnemonic: string;
  /** Bazel's own human string for how this action was actually satisfied, e.g. "remote cache
   * hit" or a real execution strategy name like "processwrapper-sandbox". */
  runner: string;
  cacheHit: boolean;
}

/** One build's worth of real per-action remote-cache results, from Bazel's own
 * --execution_log_json_file output -- only actions eligible for the remote cache at all
 * (`remoteCacheable`) are counted, so a purely local/internal action never drags the rate down as
 * if it were a miss. */
export interface CacheCheckPhaseResult {
  cacheableActions: number;
  remoteCacheHits: number;
  hitRatePercent: number;
  actions: CacheCheckAction[];
}

export interface CacheCheckRequest {
  /** A Bazel target label, e.g. "//lib:core". */
  target: string;
}

/** Result of building a target twice against the workspace's own, real, running Buildfarm's
 * remote cache -- each build against its own fresh output_base, so any reported hit is
 * unambiguously served by the remote cache, not a local one. `readCheck` reflects whatever the
 * Buildfarm already had cached going in (legitimately low/zero for a repo it's never built);
 * `roundTripCheck` re-runs the same build again, proving both write and read work end to end.
 * Always the *latest* run for a workspace, same "no history" convention as RepoAnalysisResult. */
export interface CacheCheckResult {
  status: CacheCheckStatus;
  startedAt: string;
  finishedAt: string | null;
  target: string;
  errorMessage: string | null;
  logTail: string | null;
  /** Reuses the same diagnosis engine as repo analysis / rebuild simulation -- this job can fail
   * for the same disk/OOM/timeout/missing-tool/network reasons those can. */
  diagnosis: AnalysisDiagnosis | null;
  readCheck: CacheCheckPhaseResult;
  roundTripCheck: CacheCheckPhaseResult;
}
