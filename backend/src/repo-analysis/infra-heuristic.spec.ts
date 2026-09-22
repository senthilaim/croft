import { describe, expect, it } from 'vitest';
import { estimateCosts } from '../cost/cost-estimator.js';
import { suggestBuildfarmNodes } from './infra-heuristic.js';

describe('suggestBuildfarmNodes', () => {
  it('always includes exactly one server and one worker node', () => {
    const nodes = suggestBuildfarmNodes({ cc_library: 10 });
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.type).sort()).toEqual(['server', 'worker']);
  });

  it('sizes a tiny repo to a small single-worker setup', () => {
    const [, worker] = suggestBuildfarmNodes({ cc_library: 5, cc_test: 2 });
    expect(worker.type).toBe('worker');
    const config = worker.config as { replicas: number };
    expect(config.replicas).toBe(1);
  });

  it('is monotonic: more targets never suggests fewer workers', () => {
    const histograms: Array<Record<string, number>> = [
      { cc_library: 10 },
      { cc_library: 100, cc_test: 50 },
      { cc_library: 1000, cc_test: 500, genrule: 200 },
      { cc_library: 5000, cc_test: 3000, genrule: 1000, cc_binary: 500 },
    ];
    const replicas = histograms.map((h) => {
      const worker = suggestBuildfarmNodes(h)[1];
      return (worker.config as { replicas: number }).replicas;
    });
    for (let i = 1; i < replicas.length; i++) {
      expect(replicas[i]).toBeGreaterThanOrEqual(replicas[i - 1]);
    }
  });

  it('weights tests heavier than lightweight targets like filegroup/alias', () => {
    const testHeavy = suggestBuildfarmNodes({ cc_test: 300 });
    const lightweight = suggestBuildfarmNodes({ filegroup: 300 });
    const replicasOf = (nodes: ReturnType<typeof suggestBuildfarmNodes>) =>
      (nodes[1].config as { replicas: number }).replicas;
    expect(replicasOf(testHeavy)).toBeGreaterThanOrEqual(replicasOf(lightweight));
  });

  it('handles an empty histogram without throwing', () => {
    expect(() => suggestBuildfarmNodes({})).not.toThrow();
  });

  it('plugs cleanly into the existing cost estimator with sane, non-NaN totals', () => {
    for (const histogram of [{}, { cc_library: 50 }, { cc_test: 5000, genrule: 2000 }] as Array<Record<string, number>>) {
      const nodes = suggestBuildfarmNodes(histogram);
      const report = estimateCosts({
        nodes,
        hoursPerDay: 24,
        buildsPerMonth: 0,
        buildsMeasured: false,
      });
      for (const estimate of report.estimates) {
        expect(Number.isNaN(estimate.totalMonthly)).toBe(false);
        expect(estimate.totalMonthly).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
