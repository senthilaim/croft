import type { BuildIssue } from '@croft/shared-types';

interface Rule {
  category: string;
  title: string;
  match: RegExp;
  summary: (m: RegExpMatchArray) => string;
  steps: (m: RegExpMatchArray) => string[];
}

// First match wins, so order from most specific to most general.
const RULES: Rule[] = [
  {
    category: 'platform',
    title: 'Execution platform mismatch',
    match: /Exec format error|cannot execute binary file/i,
    summary: () => 'A tool built for a different OS/CPU was sent to your Linux worker.',
    steps: () => [
      'Bazel picks toolchains for the execution platform, which defaults to your own machine.',
      'Declare a Linux execution platform and pass --extra_execution_platforms / --platforms (see "Use your own project" on the sample-project page).',
      'Make sure your project downloads a Linux SDK/toolchain for that platform (for example go_sdk.download(goos = "linux", goarch = ...)).',
    ],
  },
  {
    category: 'starlark',
    title: 'Undefined name',
    match: /name '([^']+)' is not defined/,
    summary: (m) => `'${m[1]}' is used but was never defined or loaded in this file.`,
    steps: (m) => [
      `Check the spelling of '${m[1]}'.`,
      `If it is a rule or macro from a ruleset, add a load() at the top of the file: load("@rules_xxx//path:defs.bzl", "${m[1]}").`,
      'In Bazel 8/9 many built-in rules (sh_test, cc_library, py_binary, java_library...) moved to external rules_* modules: add a bazel_dep(...) for the ruleset to MODULE.bazel and load the rule explicitly.',
    ],
  },
  {
    category: 'starlark',
    title: 'Syntax error',
    match:
      /syntax error|invalid syntax|unexpected (?:token|indent|newline|character)|expected (?:an? )?(?:expression|identifier|indented block)/i,
    summary: () => 'The file could not be parsed.',
    steps: () => [
      'Look at the reported line and the line above it: a missing comma, closing bracket or quote is the usual cause.',
      'Run "buildifier" on the file to pinpoint and auto-fix formatting/syntax problems.',
    ],
  },
  {
    category: 'labels',
    title: 'Target not found',
    match: /no such target '([^']+)'|target '([^']+)' not declared in package/,
    summary: (m) => `The label '${m[1] ?? m[2]}' does not exist.`,
    steps: (m) => [
      `Confirm a target named '${(m[1] ?? m[2]).split(':').pop()}' is declared in that package's BUILD file (name = "...").`,
      'Check the package path and target name for typos; run "bazel query //path/..." to list what exists.',
    ],
  },
  {
    category: 'labels',
    title: 'Package not found',
    match: /no such package '([^']*)'|BUILD file not found/,
    summary: (m) =>
      m[1] ? `Package '${m[1]}' has no BUILD file.` : 'A referenced package has no BUILD file.',
    steps: (m) => [
      m[1]
        ? `Create ${m[1].replace(/^@?\/*/, '')}/BUILD.bazel, or fix the label that points at it.`
        : 'Create the missing BUILD.bazel, or fix the label that points at it.',
      'If the package lives in an external repository, make sure the dependency is declared in MODULE.bazel (or WORKSPACE).',
    ],
  },
  {
    category: 'labels',
    title: 'Missing input file',
    match: /missing input file '([^']+)'/,
    summary: (m) => `A rule lists '${m[1]}' as an input but the file is not there.`,
    steps: (m) => [
      `Create or restore the file '${m[1]}', or remove it from the rule's srcs/data.`,
      'If the file is generated, make sure the target that produces it is listed as a dependency.',
    ],
  },
  {
    category: 'visibility',
    title: 'Target is not visible',
    match: /(?:target|label) '([^']+)' is not visible from target '([^']+)'/i,
    summary: (m) => `'${m[2]}' may not depend on '${m[1]}' because of its visibility setting.`,
    steps: (m) => [
      `Add visibility = ["//visibility:public"] (or a narrower package_group) to '${m[1]}'.`,
      'Alternatively depend on a public target that exposes the same functionality.',
    ],
  },
  {
    category: 'dependencies',
    title: 'External repository or module not found',
    match:
      /repository '@?([^']+)' could not be resolved|module '([^']+)' not found in registries|No repository visible as '@([^']+)'/i,
    summary: (m) => `The dependency '${m[1] ?? m[2] ?? m[3]}' is not available.`,
    steps: (m) => [
      `Add bazel_dep(name = "${m[1] ?? m[2] ?? m[3]}", version = "...") to MODULE.bazel (check registry.bazel.build for the version).`,
      'If it is a repo you defined yourself, check the name in use_repo(...) matches exactly.',
      'Ensure the machine running Bazel has network access to the registry.',
    ],
  },
  {
    category: 'compile',
    title: 'Compilation error',
    match:
      /use of undeclared identifier|fatal error: '?[^']*'? file not found|error: (?:unknown type name|expected|no member named|cannot find symbol)|cannot find symbol|package [\w.]+ does not exist|undefined: |cannot use .* as .* value/,
    summary: () => 'The compiler rejected the source file at the location shown.',
    steps: () => [
      'Fix the reported line, then rebuild - the compiler message above is the exact cause.',
      "For a missing header/package/import, add the library that provides it to the target's deps (Bazel builds hermetically, so undeclared dependencies are not visible).",
    ],
  },
  {
    category: 'link',
    title: 'Linker error',
    match: /undefined reference to|ld: symbol\(s\) not found|Undefined symbols for architecture/,
    summary: () => 'A symbol was declared but no library defining it was linked.',
    steps: () => [
      'Add the library that defines the missing symbol to deps (or to linkopts for system libraries).',
      'Check for a missing source file in srcs of the library that should define it.',
    ],
  },
  {
    category: 'test',
    title: 'Test failed',
    match: /FAILED|Test (?:failed|timed out)|timed out after/,
    summary: () => 'A test target did not pass.',
    steps: () => [
      'Open the failed action below for its stdout/stderr, or re-run with --test_output=errors locally.',
      'If it only fails sometimes, it may be flaky: check the Test grid for its history.',
    ],
  },
  {
    category: 'remote',
    title: 'Buildfarm not reachable',
    match: /UNAVAILABLE|Connection refused|failed to connect|Failed to connect to remote/i,
    summary: () => 'Bazel could not talk to the remote execution/cache server.',
    steps: () => [
      "Check the workspace shows \"running\" in the designer and that the port in .bazelrc matches the workspace's current gRPC port.",
      'Re-download the sample project (or copy the .bazelrc from the "Use your own project" section) if the port changed.',
    ],
  },
  {
    category: 'options',
    title: 'Unknown command-line option',
    match: /Unrecognized option|Unknown option|unknown startup option/i,
    summary: () => 'Bazel does not recognise a flag in the command or a .bazelrc file.',
    steps: () => [
      'Check the spelling and that the flag exists in your Bazel version (bazel help build).',
      'A flag placed under the wrong command section in .bazelrc (build vs test) is a common cause.',
    ],
  },
  {
    category: 'permissions',
    title: 'Permission denied',
    match: /Permission denied/i,
    summary: () => 'An action or file access was refused by the OS.',
    steps: () => [
      'Make scripts executable (chmod +x) and make sure the path is inside the workspace.',
      'Check for read-only files or directories owned by another user.',
    ],
  },
];

const SYMPTOM_RE =
  /^Error evaluating '[^']*'|contains errors$|Analysis of target '[^']*' failed|build aborted|Build did NOT complete successfully|command succeeded, but not all targets were analyzed|^Loading failed|^Analysis failed|Couldn't start the build|^Skipping '[^']*':/i;

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g');
const BAZEL_ERROR_RE = /^(?:ERROR|Error in [\w.]+|FATAL): (.+?):(\d+):(\d+): (.*)$/;
const BAZEL_ERROR_NOLOC_RE = /^ERROR: (.*)$/;
const COMPILER_RE = /^(\/?[^\s:][^:]*?):(\d+):(?:(\d+):)? (?:fatal )?error: (.*)$/;
const STARLARK_FRAME_RE = /^\s*File "(.+?)", line (\d+), column (\d+), in (\S+)/;
const STARLARK_ERROR_RE = /^(?:Error|Error in [\w.]+): (.*)$/;
const NEW_RECORD_RE = /^(?:ERROR|WARNING|INFO|DEBUG|FAIL|Loading|Analyzing|\[\d+ \/ \d+\])/;
const MAX_CONTEXT_LINES = 8;
const MAX_ISSUES = 10;

interface Draft {
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
  context: string[];
}

function collect(text: string): Draft[] {
  const drafts: Draft[] = [];
  const lines = text.replace(ANSI_RE, '').split(/\r?\n/);
  let pendingFrame: { file: string; line: number; column: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let draft: Draft | null = null;

    let m = line.match(BAZEL_ERROR_RE);
    if (m) {
      draft = { file: m[1], line: Number(m[2]), column: Number(m[3]), message: m[4], context: [] };
    } else if ((m = line.match(COMPILER_RE))) {
      draft = {
        file: m[1],
        line: Number(m[2]),
        column: m[3] ? Number(m[3]) : null,
        message: m[4],
        context: [],
      };
    } else if ((m = line.match(STARLARK_FRAME_RE))) {
      pendingFrame = { file: m[1], line: Number(m[2]), column: Number(m[3]) };
      continue;
    } else if ((m = line.match(STARLARK_ERROR_RE)) && pendingFrame) {
      draft = { ...pendingFrame, message: m[1], context: [] };
      pendingFrame = null;
    } else if ((m = line.match(BAZEL_ERROR_NOLOC_RE))) {
      draft = { file: null, line: null, column: null, message: m[1], context: [] };
    }
    if (!draft) continue;
    if (!draft.file) {
      const definedBy = draft.message.match(/defined by (\/\S+?)(?::(\d+):(\d+))?$/);
      if (definedBy) {
        draft.file = definedBy[1];
        draft.line = definedBy[2] ? Number(definedBy[2]) : null;
        draft.column = definedBy[3] ? Number(definedBy[3]) : null;
      }
    }

    for (let j = i + 1; j < lines.length && draft.context.length < MAX_CONTEXT_LINES; j++) {
      const next = lines[j];
      if (!next.trim() || NEW_RECORD_RE.test(next) || COMPILER_RE.test(next)) break;
      draft.context.push(next.trimEnd());
    }
    drafts.push(draft);
  }
  return drafts;
}

function toIssue(draft: Draft): BuildIssue {
  const haystack = [draft.message, ...draft.context].join('\n');
  const symptom = SYMPTOM_RE.test(draft.message);
  let rule: Rule | undefined;
  let match: RegExpMatchArray | null = null;
  for (const candidate of RULES) {
    const m = haystack.match(candidate.match);
    if (m) {
      rule = candidate;
      match = m;
      break;
    }
  }

  const recommendation =
    rule && match
      ? { summary: rule.summary(match), steps: rule.steps(match) }
      : symptom
        ? {
            summary: 'This is a summary line; the underlying error is reported separately.',
            steps: ['Fix the first error listed for this build, then rebuild.'],
          }
        : {
            summary: 'Bazel reported an error at this location.',
            steps: [
              draft.file
                ? `Open ${draft.file}${draft.line ? ` at line ${draft.line}` : ''} and address the message above.`
                : 'Read the message above and the console log for the failing step.',
              'Rebuild after the fix. If the message is unclear, run the same command locally with --verbose_failures.',
            ],
          };

  return {
    severity: 'error',
    category: rule?.category ?? 'other',
    title: rule?.title ?? (symptom ? 'Build failed' : 'Build error'),
    message: draft.message,
    file: draft.file,
    line: draft.line,
    column: draft.column,
    context: draft.context,
    symptom,
    recommendation,
  };
}

/**
 * Turns Bazel's console output (and failed-action stderr) into located, actionable issues.
 * Root causes come first; summary lines like "Package 'app' contains errors" are only kept when
 * nothing more specific was found.
 */
export function diagnoseBuild(sources: Array<string | null | undefined>): BuildIssue[] {
  const seen = new Set<string>();
  const issues: BuildIssue[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const draft of collect(source)) {
      const key = `${draft.file}:${draft.line}:${draft.column}:${draft.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(toIssue(draft));
    }
  }
  // Bazel repeats one problem in several forms ("ERROR: /f:1:1: msg" then "ERROR: package
  // contains errors: app: msg"): keep the located one and drop location-less echoes of it.
  const located = issues.filter((i) => i.file);
  for (let idx = issues.length - 1; idx >= 0; idx--) {
    const issue = issues[idx];
    if (!issue.file && located.some((l) => issue.message.includes(l.message))) issues.splice(idx, 1);
  }

  const rootCauses = issues.filter((i) => !i.symptom);
  const chosen = rootCauses.length > 0 ? rootCauses : issues;
  return chosen.slice(0, MAX_ISSUES);
}
