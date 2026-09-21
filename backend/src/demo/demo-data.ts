import { randomUUID } from 'node:crypto';

// Deterministic PRNG so a demo looks the same shape every time it is generated.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOT = '/workspace/demo-shop';

export interface DemoBuild {
  invocationId: string;
  command: string;
  startTime: string;
  endTime: string;
  status: 'success' | 'failure';
  targets: Array<{ label: string; status: 'success' | 'failure'; durationMs: number }>;
  totalDurationMs: number;
  errorMessage: string | null;
  actionsCreated: number;
  actionsExecuted: number;
  remoteCacheHits: number;
  actions: Array<{
    label: string;
    mnemonic: string;
    exitCode: number;
    commandLine: string[];
    primaryOutputPath: string | null;
    startTime: string;
    endTime: string;
    stdout: string | null;
    stderr: string | null;
  }>;
  waterfall: Array<{ name: string; category: string; lane: string; startMs: number; durationMs: number }>;
  consoleLog: string | null;
  demo: true;
}

export interface DemoTestRun {
  invocationId: string;
  label: string;
  status: 'passed' | 'flaky' | 'failed';
  runCount: number;
  totalDurationMs: number;
  startTime: string;
  buildIndex: number;
}

interface FailureScenario {
  log: string[];
  error: string;
  action?: DemoBuild['actions'][number] extends infer A ? Omit<A & object, 'startTime' | 'endTime'> : never;
  durationMs: [number, number];
}

const LIB_TARGETS = ['//lib:util', '//lib:core', '//api:proto'];
const APP_TARGETS = ['//app:server', '//app:web'];
const ALL_TARGETS = [...LIB_TARGETS, ...APP_TARGETS];

const FAILURES: FailureScenario[] = [
  {
    log: [
      "Loading: 0 packages loaded",
      `ERROR: ${ROOT}/app/BUILD.bazel:14:1: name 'cc_library' is not defined`,
      `ERROR: package contains errors: app: name 'cc_library' is not defined`,
      "ERROR: Skipping '//app/...': Error evaluating '//app/...': error loading package 'app': Package 'app' contains errors",
      'FAILED: Build did NOT complete successfully',
    ],
    error: "Error evaluating '//app/...': error loading package 'app': Package 'app' contains errors",
    durationMs: [120, 600],
  },
  {
    log: [
      `ERROR: ${ROOT}/app/BUILD.bazel:22:15: no such target '//lib:utils': target 'utils' not declared in package 'lib' defined by ${ROOT}/lib/BUILD.bazel`,
      "ERROR: Analysis of target '//app:server' failed; build aborted",
      'FAILED: Build did NOT complete successfully',
    ],
    error: "no such target '//lib:utils': target 'utils' not declared in package 'lib'",
    durationMs: [300, 900],
  },
  {
    log: [
      `ERROR: ${ROOT}/lib/BUILD.bazel:8:11: Compiling lib/core.cc failed: (Exit 1): clang failed: error executing CppCompile command`,
      "lib/core.cc:42:5: error: use of undeclared identifier 'parse_config'",
      '  parse_config(argc, argv);',
      '  ^',
      'FAILED: Build did NOT complete successfully',
    ],
    error: `${ROOT}/lib/BUILD.bazel:8:11: Compiling lib/core.cc failed: (Exit 1)`,
    action: {
      label: '//lib:core',
      mnemonic: 'CppCompile',
      exitCode: 1,
      commandLine: ['clang', '-c', 'lib/core.cc', '-o', 'bazel-out/k8-fastbuild/bin/lib/_objs/core/core.o'],
      primaryOutputPath: 'bazel-out/k8-fastbuild/bin/lib/_objs/core/core.o',
      stdout: null,
      stderr: "lib/core.cc:42:5: error: use of undeclared identifier 'parse_config'\n  parse_config(argc, argv);\n  ^",
    },
    durationMs: [4000, 12000],
  },
  {
    log: [
      `ERROR: ${ROOT}/web/BUILD.bazel:5:10: Label '//lib:internal' is not visible from target '//web:app'. Check the visibility declaration of the former target.`,
      'FAILED: Build did NOT complete successfully',
    ],
    error: "Label '//lib:internal' is not visible from target '//web:app'",
    durationMs: [200, 700],
  },
];

export interface DemoData {
  builds: DemoBuild[];
  testRuns: DemoTestRun[];
}

/** Realistic sample invocations spread over the last `days` days: cold-cache first builds that warm
 * up, occasional failures of several kinds, and a flaky test, so every analytics view has data. */
export function generateDemoData(now = new Date(), days = 14, seed = 42): DemoData {
  const rand = mulberry32(seed);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

  const total = 44;
  const spanMs = days * 86_400_000;
  const builds: DemoBuild[] = [];
  const testRuns: DemoTestRun[] = [];
  let failureCursor = 0;

  for (let i = 0; i < total; i++) {
    const progress = i / (total - 1);
    const start = new Date(now.getTime() - spanMs + progress * spanMs - rand() * 3_600_000);
    const isTest = i % 3 === 1;
    const failEvery = i > 6 && rand() < 0.22;
    const command = isTest ? 'test' : 'build';
    const targets = isTest
      ? ['//lib:core_test', '//app:server_test', '//web:e2e_test']
      : [...LIB_TARGETS, ...(rand() < 0.7 ? APP_TARGETS : [])];

    // Cache warms up over the fortnight: near 0% at first, ~85% by the end (with noise).
    const warmth = Math.min(0.9, progress * 1.1 + rand() * 0.1);
    const actionsExecuted = Math.round(between(18, 60));

    if (failEvery) {
      const scenario = FAILURES[failureCursor++ % FAILURES.length];
      const durationMs = Math.round(between(scenario.durationMs[0], scenario.durationMs[1]));
      const end = new Date(start.getTime() + durationMs);
      const isCompile = Boolean(scenario.action);
      builds.push({
        invocationId: randomUUID(),
        command,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        status: 'failure',
        targets: isCompile ? [{ label: '//lib:core', status: 'failure', durationMs }] : [],
        totalDurationMs: durationMs,
        errorMessage: scenario.error,
        actionsCreated: isCompile ? actionsExecuted : 0,
        actionsExecuted: isCompile ? Math.round(actionsExecuted * 0.4) : 0,
        remoteCacheHits: isCompile ? Math.round(actionsExecuted * 0.4 * warmth) : 0,
        actions: scenario.action
          ? [{ ...scenario.action, startTime: start.toISOString(), endTime: end.toISOString() }]
          : [],
        waterfall: [],
        consoleLog: ['INFO: Invocation ID: demo', ...scenario.log].join('\n'),
        demo: true,
      });
      continue;
    }

    const hits = Math.round(actionsExecuted * warmth);
    const remoteMs = actionsExecuted * between(90, 160) * (1 - warmth * 0.8);
    const durationMs = Math.round(Math.max(800, remoteMs + between(600, 2500)));
    const end = new Date(start.getTime() + durationMs);
    const builtTargets = targets.map((label) => ({
      label,
      status: 'success' as const,
      durationMs: Math.round(between(200, 6000) * (1 - warmth * 0.6)),
    }));

    const spans = [{ name: 'analysis', category: 'build phase', lane: 'main thread', startMs: 0, durationMs: Math.round(durationMs * 0.12) }];
    let cursor = Math.round(durationMs * 0.12);
    builtTargets.forEach((t, n) => {
      const d = Math.min(t.durationMs, Math.max(50, durationMs - cursor));
      spans.push({ name: `${t.label} (${pick(['CppCompile', 'CppLink', 'GoCompile', 'ProtoCompile'])})`, category: 'action', lane: `worker ${n + 1}`, startMs: cursor, durationMs: d });
      cursor += Math.round(d * 0.5);
    });

    builds.push({
      invocationId: randomUUID(),
      command,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      status: 'success',
      targets: builtTargets,
      totalDurationMs: durationMs,
      errorMessage: null,
      actionsCreated: actionsExecuted,
      actionsExecuted,
      remoteCacheHits: hits,
      actions: [],
      waterfall: spans,
      consoleLog: `INFO: Invocation ID: demo\nINFO: Build completed successfully, ${actionsExecuted} total actions`,
      demo: true,
    });

    if (isTest) {
      const buildIndex = builds.length - 1;
      const inv = builds[buildIndex].invocationId;
      const flakyRoll = rand();
      testRuns.push(
        { invocationId: inv, label: '//lib:core_test', status: 'passed', runCount: 1, totalDurationMs: Math.round(between(300, 900)), startTime: start.toISOString(), buildIndex },
        { invocationId: inv, label: '//app:server_test', status: 'passed', runCount: 1, totalDurationMs: Math.round(between(800, 2200)), startTime: start.toISOString(), buildIndex },
        {
          invocationId: inv,
          label: '//web:e2e_test',
          status: flakyRoll < 0.4 ? 'failed' : flakyRoll < 0.6 ? 'flaky' : 'passed',
          runCount: flakyRoll < 0.6 ? 3 : 1,
          totalDurationMs: Math.round(between(2500, 7000)),
          startTime: start.toISOString(),
          buildIndex,
        },
      );
    }
  }

  return { builds, testRuns };
}
