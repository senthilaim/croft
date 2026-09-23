import type { AnalysisDiagnosis } from '@croft/shared-types';

interface Rule {
  category: string;
  title: string;
  match: RegExp;
  /** false when this failure is a current Croft/sandbox limitation, not something the repo owner
   * can fix themselves. */
  selfServiceable: boolean;
  summary: string;
  steps: string[];
}

// First match wins, so order from most specific to most general. Checked against the sandbox job's
// full text (errorMessage + logTail) -- see diagnoseAnalysisFailure below.
const RULES: Rule[] = [
  {
    category: 'disk',
    title: 'Ran out of disk space',
    match: /No space left on device/,
    selfServiceable: false,
    summary:
      "The analysis sandbox ran out of disk space extracting this repository's dependencies. " +
      'Very large repositories can need more space than the sandbox has available.',
    steps: [
      'Try analyzing again -- disk usage on the host may have freed up since.',
      "If this keeps happening, it's a current limitation of Croft's analysis sandbox on this host, not a problem with your repository.",
    ],
  },
  {
    category: 'bazel-version',
    title: 'Bazel/WORKSPACE version mismatch',
    match: /No repository visible as '@|could not be resolved.*repository|repository '.*' could not be resolved/,
    selfServiceable: true,
    summary:
      'Every package failed to load, which usually means a dependency declared in WORKSPACE ' +
      "(not MODULE.bazel) isn't visible under the Bazel version the sandbox used.",
    steps: [
      'Add a .bazelversion file to your repository pinning a Bazel release that supports your dependency setup (Bazel 7.x supports both WORKSPACE and bzlmod).',
      'Or migrate the missing dependency to MODULE.bazel with a bazel_dep(...) entry.',
    ],
  },
  {
    category: 'missing-tool',
    title: 'A required build tool is missing from the sandbox',
    match: /(node|npm|go|gcc|cc|make|protoc|cmake|python3?|java|javac|rustc|cargo):?\s*(?:command not found|not found)|No such file or directory.*\b(node|npm|go|gcc|cc|make|protoc|cmake|rustc|cargo)\b/,
    selfServiceable: false,
    summary:
      "This repository's dependency fetch needs a tool that isn't installed in Croft's analysis " +
      'sandbox.',
    steps: [
      "This is a current limitation of Croft's analysis sandbox, not a problem with your repository.",
      'If you run Croft yourself, the sandbox image can be extended with the missing tool.',
    ],
  },
  {
    category: 'out-of-memory',
    title: 'The sandbox ran out of memory',
    match: /\bKilled\b|Cannot allocate memory|OutOfMemoryError|exit code 137/,
    selfServiceable: false,
    summary: "The analysis container was killed for exceeding its memory limit -- a large repository's dependency graph can need more than the sandbox is configured with.",
    steps: [
      'Try analyzing again in case this was a transient spike.',
      "If it keeps happening, this repository needs a higher memory limit than Croft's analysis sandbox is currently configured with (an operator can raise ANALYSIS_MEMORY_LIMIT).",
    ],
  },
  {
    category: 'timeout',
    title: 'Analysis took too long',
    match: /Analysis exceeded the time limit/,
    selfServiceable: false,
    summary: 'The analysis sandbox has a wall-clock time limit, and this run did not finish within it.',
    steps: [
      'Try again -- a slow dependency download can make one run hit the limit without it being a persistent problem.',
      'A very large repository may need a longer limit than Croft is currently configured with (an operator can raise ANALYSIS_TIMEOUT_SECONDS).',
    ],
  },
  {
    category: 'branch',
    title: 'Branch not found',
    match: /Remote branch .* not found|couldn't find remote ref/i,
    selfServiceable: true,
    summary: "The branch Croft tried to clone doesn't exist on GitHub.",
    steps: [
      'Disconnect and reconnect the repository -- this re-checks the current default branch.',
      'Confirm the branch was not renamed or deleted since connecting.',
    ],
  },
  {
    category: 'auth',
    title: 'GitHub rejected the request',
    match: /Authentication failed|fatal: could not read Username|Repository not found/,
    selfServiceable: true,
    summary: 'GitHub refused to let the sandbox clone this repository.',
    steps: [
      'Reconnect with a new personal access token -- the stored one may have expired or been revoked.',
      'Confirm the token still has read access to this specific repository.',
    ],
  },
  {
    category: 'network',
    title: 'A network problem outlasted automatic retries',
    match: /could not download Bazel|unexpected EOF|TLS handshake|connection reset by peer|i\/o timeout|Temporary failure in name resolution|context deadline exceeded|Could not resolve host/,
    selfServiceable: false,
    summary:
      'A network interruption kept happening even after Croft automatically retried the analysis ' +
      'a few times.',
    steps: ['Try again in a few minutes -- this is almost always transient.'],
  },
];

/** Classifies a failed (or zero-target) analysis from its console output into a known failure
 * class, mirroring backend/src/builds/build-diagnostics.ts's approach for failed builds. Returns
 * null when nothing matches -- the caller falls back to the plain errorMessage + log, which is
 * also the signal that a new rule is worth adding. */
export function diagnoseAnalysisFailure(
  errorMessage: string | null,
  logTail: string | null,
): AnalysisDiagnosis | null {
  const haystack = [errorMessage, logTail].filter(Boolean).join('\n');
  if (!haystack) return null;

  for (const rule of RULES) {
    if (rule.match.test(haystack)) {
      return {
        category: rule.category,
        title: rule.title,
        summary: rule.summary,
        recommendedSteps: rule.steps,
        selfServiceable: rule.selfServiceable,
      };
    }
  }
  return null;
}
