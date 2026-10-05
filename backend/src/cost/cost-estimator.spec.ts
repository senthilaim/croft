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

  it('does not add a cache compute requirement when remoteCacheTier is unset (today\'s plain cache node)', () => {
    const req = requirementsFrom(nodes);
    expect(req.nodes.some((n) => n.role === 'cache')).toBe(false);
    expect(req.s3StorageGb).toBe(0);
  });

  it('adds a cache compute requirement for the "local" tier but no S3 storage', () => {
    const withLocalTier = nodes.map((n) =>
      n.type === 'cache' ? { ...n, config: { ...n.config, remoteCacheTier: 'local' } } : n,
    ) as unknown as BuildfarmNode[];
    const req = requirementsFrom(withLocalTier);
    expect(req.nodes.some((n) => n.role === 'cache')).toBe(true);
    expect(req.s3StorageGb).toBe(0);
  });

  it('adds both a cache compute requirement and S3 storage for the "s3"/"both" tiers', () => {
    for (const tier of ['s3', 'both']) {
      const withTier = nodes.map((n) =>
        n.type === 'cache' ? { ...n, config: { ...n.config, remoteCacheTier: tier } } : n,
      ) as unknown as BuildfarmNode[];
      const req = requirementsFrom(withTier);
      expect(req.nodes.some((n) => n.role === 'cache')).toBe(true);
      expect(req.s3StorageGb).toBe(200); // reuses the cache node's own sizeGb
    }
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

  it('prices S3 storage at a cheaper rate than generic block storage, only on the aws row', () => {
    const withS3 = nodes.map((n) =>
      n.type === 'cache' ? { ...n, config: { ...n.config, remoteCacheTier: 's3' } } : n,
    ) as unknown as BuildfarmNode[];
    const report = estimateCosts({ nodes: withS3, hoursPerDay: 24, buildsPerMonth: 0, buildsMeasured: false });
    const baseline = estimateCosts({ nodes, hoursPerDay: 24, buildsPerMonth: 0, buildsMeasured: false });

    const awsWithS3 = report.estimates.find((e) => e.provider === 'aws')!;
    const awsBaseline = baseline.estimates.find((e) => e.provider === 'aws')!;
    // Extra storage cost is 200 GB * $0.023/GB -- materially less than the same 200 GB would cost
    // at the generic $0.08/GB block-storage rate already used for storageGb.
    expect(awsWithS3.storageMonthly - awsBaseline.storageMonthly).toBeCloseTo(200 * 0.023, 1);

    // gcp/azure have no s3PerGbMonth configured -- the same S3 tier contributes $0 to their columns
    // this release, rather than an invented GCS/Blob rate.
    const gcpWithS3 = report.estimates.find((e) => e.provider === 'gcp')!;
    const gcpBaseline = baseline.estimates.find((e) => e.provider === 'gcp')!;
    expect(gcpWithS3.storageMonthly).toBeCloseTo(gcpBaseline.storageMonthly, 1);
  });

  it('notes that cost can scale up when maxReplicas exceeds the desired replica count', () => {
    const withMaxReplicas = nodes.map((n) =>
      n.type === 'worker' ? { ...n, config: { ...n.config, maxReplicas: 10 } } : n,
    ) as unknown as BuildfarmNode[];
    const withoutMaxReplicas = estimateCosts({ nodes, hoursPerDay: 24, buildsPerMonth: 0, buildsMeasured: false });
    const withScaling = estimateCosts({
      nodes: withMaxReplicas, hoursPerDay: 24, buildsPerMonth: 0, buildsMeasured: false,
    });

    const awsWithout = withoutMaxReplicas.estimates.find((e) => e.provider === 'aws')!;
    const awsWith = withScaling.estimates.find((e) => e.provider === 'aws')!;
    expect(awsWithout.notes.some((n) => n.includes('scale up'))).toBe(false);
    expect(awsWith.notes.some((n) => n.includes('scale up to 10 workers'))).toBe(true);
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
