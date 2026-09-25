import type { AnalysisDiagnosis } from "./repo-analysis.js";

export type RebuildSimulationStatus = "pending" | "running" | "succeeded" | "failed";

/** Why Bazel's --explain said an action re-ran on the second build. "changed": a real
 * content/input change (what an edit like the one this tool makes triggers). "unconditional":
 * always re-executes regardless of any edit (e.g. the workspace-status action) -- not caused by
 * the file change, shown separately so it isn't mistaken for one. "new": the action had no cache
 * entry at all -- only expected on a cold build. "other": a reason Croft doesn't recognize yet. */
export type RebuildActionCategory = "new" | "changed" | "unconditional" | "other";

export interface RebuiltAction {
  /** Bazel's own free-text action description, e.g. "Compiling core.cc" or "Linking app" -- not
   * a clean target label, since that's what --explain actually emits. */
  description: string;
  reason: string;
  category: RebuildActionCategory;
}

export interface RebuildSimulationRequest {
  /** A Bazel target label, e.g. "//lib:core". */
  target: string;
  /** A repo-relative path to a text source file -- gets a single newline appended to trigger a
   * real content-hash change (see explain_parser.py's docstring for why not a bare touch). */
  filePath: string;
}

/** Result of building a target twice inside the sandbox -- once cold, once after a real edit to
 * `filePath` -- with --explain on the second build. Always the *latest* run for a workspace, same
 * "no history" convention as RepoAnalysisResult. */
export interface RebuildSimulationResult {
  status: RebuildSimulationStatus;
  startedAt: string;
  finishedAt: string | null;
  target: string;
  filePath: string;
  errorMessage: string | null;
  /** Tail of the sandboxed job's console output -- live while running, final on success/failure. */
  logTail: string | null;
  /** Reuses the same diagnosis engine as repo analysis -- a simulation can fail for the same
   * disk/OOM/timeout/missing-tool/network reasons an analysis can. */
  diagnosis: AnalysisDiagnosis | null;
  rebuiltActions: RebuiltAction[];
  totalActionsRebuilt: number;
  /** Actions executed by the first (cold) build -- the denominator for "N of M actions rebuilt". */
  baselineTotalActions: number;
  countsByCategory: Partial<Record<RebuildActionCategory, number>>;
}
