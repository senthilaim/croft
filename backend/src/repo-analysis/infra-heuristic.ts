import type { BuildfarmNode } from '@croft/shared-types';

// Coarse, explicitly-rough per-kind build-cost weights: tests run as well as build (heavier),
// binaries/genrules are a normal unit of work, and filegroup/alias-style targets are nearly free.
// Deliberately not a regression model -- see infra-heuristic.spec.ts and the plan for why.
const KIND_WEIGHTS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /test$/i, weight: 1.5 },
  { pattern: /^(filegroup|alias|bind|_license|package_group)$/i, weight: 0.1 },
  { pattern: /^(cc_binary|cc_library|genrule|java_binary|java_library|go_binary|go_library|py_binary|py_library)$/i, weight: 1 },
];
const DEFAULT_WEIGHT = 0.7; // anything unrecognised: assume it's lighter than a real compile/link.

// Work-unit thresholds -> worker sizing. Ordered smallest first; the first bucket whose ceiling
// is not exceeded wins.
const WORKER_BUCKETS: Array<{ maxWorkUnits: number; replicas: number; cpuLimit: string; memoryLimitMb: number }> = [
  { maxWorkUnits: 200, replicas: 1, cpuLimit: '2', memoryLimitMb: 4096 },
  { maxWorkUnits: 1000, replicas: 3, cpuLimit: '4', memoryLimitMb: 8192 },
  { maxWorkUnits: 5000, replicas: 6, cpuLimit: '4', memoryLimitMb: 8192 },
  { maxWorkUnits: 20000, replicas: 12, cpuLimit: '8', memoryLimitMb: 16384 },
];
const LARGEST_BUCKET = { replicas: 24, cpuLimit: '8', memoryLimitMb: 16384 };

function weightFor(kind: string): number {
  return KIND_WEIGHTS.find((k) => k.pattern.test(kind))?.weight ?? DEFAULT_WEIGHT;
}

function workUnitsFor(targetsByKind: Record<string, number>): number {
  return Object.entries(targetsByKind).reduce((sum, [kind, count]) => sum + weightFor(kind) * count, 0);
}

/**
 * Turns a repo's target-kind histogram (from repo analysis) into a rough starting-point Buildfarm
 * topology, sized off target count and a coarse per-kind weighting -- not a guarantee, a starting
 * point to hand to estimateCosts(). Always one small fixed server plus a sized worker, matching the
 * shapes ServerNodeConfig/WorkerNodeConfig expect.
 */
export function suggestBuildfarmNodes(targetsByKind: Record<string, number>): BuildfarmNode[] {
  const workUnits = workUnitsFor(targetsByKind);
  const bucket = WORKER_BUCKETS.find((b) => workUnits <= b.maxWorkUnits) ?? LARGEST_BUCKET;

  return [
    {
      id: 'server',
      type: 'server',
      position: { x: 0, y: 0 },
      config: { cpuLimit: '1', memoryLimitMb: 1024 },
    },
    {
      id: 'worker',
      type: 'worker',
      position: { x: 0, y: 200 },
      config: {
        replicas: bucket.replicas,
        cpuLimit: bucket.cpuLimit,
        memoryLimitMb: bucket.memoryLimitMb,
        executionEnabled: true,
      },
    },
  ];
}
