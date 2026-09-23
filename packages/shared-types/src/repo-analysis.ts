import type { BuildfarmNode } from "./buildfarm-config.js";

export type RepoProvider = "github";
export type RepoAnalysisStatus = "pending" | "running" | "succeeded" | "failed";

/** Public view of a connected repo -- never includes the token in any form. */
export interface RepoConnection {
  workspaceId: string;
  provider: RepoProvider;
  owner: string;
  repo: string;
  defaultBranch: string;
  /** Last 4 characters of the token, so the UI can confirm which one is stored without ever
   * decrypting it for display. */
  tokenLast4: string;
  connectedBy: string;
  connectedAt: string;
}

export interface ConnectRepoRequest {
  /** e.g. "https://github.com/owner/repo" */
  repoUrl: string;
  /** A read-only, repo-scoped GitHub Personal Access Token. */
  token: string;
}

export interface ExternalDependency {
  repoName: string;
  /** Resolved from `bazel mod graph` for bzlmod repos; null for WORKSPACE-only repos or when it
   * couldn't be determined. */
  version: string | null;
}

export interface PackageGraphNode {
  /** A Bazel package path, e.g. "//foo/bar", or an external repo name like "@boost". */
  id: string;
  targetCount: number;
}

export interface PackageGraphEdge {
  source: string;
  target: string;
}

export interface PackageGraph {
  nodes: PackageGraphNode[];
  edges: PackageGraphEdge[];
  /** True when the real graph exceeded the render cap and only the most-connected packages are
   * included. */
  truncated: boolean;
}

/** A recognized class of analysis failure (or empty-result run), matched from the sandbox's
 * console output -- e.g. "disk full", "Bazel/WORKSPACE version mismatch", "missing system tool".
 * Not every failure matches a rule; when none does, this is null and the UI falls back to the
 * plain errorMessage + log. */
export interface AnalysisDiagnosis {
  category: string;
  title: string;
  summary: string;
  recommendedSteps: string[];
  /** true: something the user can fix in their own repo (pin a Bazel version, fix a branch name).
   * false: a current limitation of Croft's analysis sandbox, not the repo's fault. */
  selfServiceable: boolean;
}

/** Result of running `bazel query` against a connected repo inside the sandboxed analysis job.
 * Always the *latest* run for a workspace -- re-analyzing replaces this wholesale, there is no
 * history. */
export interface RepoAnalysisResult {
  status: RepoAnalysisStatus;
  startedAt: string;
  finishedAt: string | null;
  commitSha: string | null;
  errorMessage: string | null;
  /** Tail of the sandboxed job's console output (clone progress, bazel query progress, and on
   * failure the real error). Live while running, final on success/failure. */
  logTail: string | null;
  /** Set for a failed run, or a succeeded run that found zero targets -- see AnalysisDiagnosis. */
  diagnosis: AnalysisDiagnosis | null;
  /** Non-fatal issues, e.g. "query completed with errors on some packages" from --keep_going. */
  warnings: string[];
  /** Rule kind (cc_library, cc_test, genrule, ...) to count. */
  targetsByKind: Record<string, number>;
  totalTargets: number;
  totalPackages: number;
  externalDeps: ExternalDependency[];
  packageGraph: PackageGraph;
  /** A rough starting-point Buildfarm topology sized from this repo's target count -- feed
   * straight into the cost estimator's estimateCosts(). Not a guarantee. */
  suggestedNodes: BuildfarmNode[];
}
