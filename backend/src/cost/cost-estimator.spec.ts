import { describe, expect, it } from 'vitest';
import type { BuildfarmNode } from '@croft/shared-types';
import { estimateCosts, requirementsFrom } from './cost-estimator.js';

const nodes = [
  { id: 's', type: 'server', position: { x: 0, y: 0 }, config: { cpuLimit: '1', memoryLimitMb: 1024 } },
  { id: 'w', type: 'worker', position: { x: 0, y: 0 }, config: { replicas: 4, cpuLimit: '2', memoryLimitMb: 4096, executionEnabled: true } },
  { id: 'r', type: 'redis', position: { x: 0, y: 0 }, config: { memoryLimitMb: 512 } },
  { id: 'c', type: 'cache', position: { x: 0, y: 0 }, config: { sizeGb: 200 } },
] as unknown as BuildfarmNode[];

describe('cost estimator', () => {
  it('sums requirements across replicas and uses cache size for storage', () => {
    const req = requirementsFrom(nodes);
    expect(req.vcpu).toBe(9.25);
    expect(req.memGb).toBe(17.5);
    expect(req.storageGb).toBe(200);
  });

  it('applies a minimum storage when no cache node exists', () => {
    expect(requirementsFrom(nodes.slice(0, 3)).storageGb).toBe(50);
  });

  it('prices each cloud, with spot cheaper than on-demand and per-build cost from volume', () => {
    const report = estimateCosts({ nodes, hoursPerDay: 24, buildsPerMonth: 1000, buildsMeasured: true });
    const aws = report.estimates.find((e) => e.provider === 'aws')!;
    expect(aws.instance!.count * aws.instance!.vcpu * 1 / 1.15).toBeGreaterThanOrEqual(req9(report));
    expect(aws.totalMonthly).toBeGreaterThan(0);
    expect(aws.spotMonthly!).toBeLessThan(aws.totalMonthly);
    expect(aws.perBuild).toBeCloseTo(aws.totalMonthly / 1000, 2);
    expect(report.estimates.find((e) => e.provider === 'docker')!.totalMonthly).toBe(0);
  });

  it('scales compute with hours per day but not storage', () => {
    const full = estimateCosts({ nodes, hoursPerDay: 24, buildsPerMonth: 0, buildsMeasured: false });
    const half = estimateCosts({ nodes, hoursPerDay: 12, buildsPerMonth: 0, buildsMeasured: false });
    const f = full.estimates.find((e) => e.provider === 'gcp')!;
    const h = half.estimates.find((e) => e.provider === 'gcp')!;
    expect(h.computeMonthly).toBeCloseTo(f.computeMonthly / 2, 1);
    expect(h.storageMonthly).toBe(f.storageMonthly);
    expect(f.perBuild).toBeNull();
  });

  it('honours a custom on-prem rate', () => {
    const cheap = estimateCosts({ nodes, hoursPerDay: 24, buildsPerMonth: 0, buildsMeasured: false, onPremVcpuHour: 0.01 });
    const dear = estimateCosts({ nodes, hoursPerDay: 24, buildsPerMonth: 0, buildsMeasured: false, onPremVcpuHour: 0.04 });
    const c = cheap.estimates.find((e) => e.provider === 'onprem')!.totalMonthly;
    const d = dear.estimates.find((e) => e.provider === 'onprem')!.totalMonthly;
    expect(d).toBeCloseTo(c * 4, 1);
  });
});

function req9(report: { requirements: { vcpu: number } }) {
  return report.requirements.vcpu;
}
