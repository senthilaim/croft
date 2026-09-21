import { describe, expect, it } from 'vitest';
import { diagnoseBuild } from '../builds/build-diagnostics.js';
import { generateDemoData } from './demo-data.js';

const now = new Date('2026-09-21T12:00:00Z');

describe('demo data', () => {
  const { builds, testRuns } = generateDemoData(now);

  it('spans two weeks, all marked as demo, with unique invocation ids', () => {
    expect(builds.length).toBeGreaterThanOrEqual(40);
    expect(builds.every((b) => b.demo)).toBe(true);
    expect(new Set(builds.map((b) => b.invocationId)).size).toBe(builds.length);
    const oldest = Math.min(...builds.map((b) => new Date(b.startTime).getTime()));
    expect(now.getTime() - oldest).toBeGreaterThan(12 * 86_400_000);
    expect(builds.every((b) => new Date(b.startTime) <= now)).toBe(true);
  });

  it('includes both successes and several distinct kinds of failure that the diagnosis understands', () => {
    const failed = builds.filter((b) => b.status === 'failure');
    expect(failed.length).toBeGreaterThan(3);
    expect(builds.some((b) => b.status === 'success')).toBe(true);
    const titles = new Set(
      failed.flatMap((b) => diagnoseBuild([b.consoleLog, b.errorMessage, ...b.actions.map((a) => a.stderr)]).map((i) => i.title)),
    );
    expect(titles.size).toBeGreaterThanOrEqual(3);
    for (const b of failed) {
      const [first] = diagnoseBuild([b.consoleLog, b.errorMessage]);
      expect(first?.file ?? first?.title).toBeTruthy();
    }
  });

  it('warms the remote cache over time', () => {
    const ok = builds.filter((b) => b.status === 'success' && b.actionsExecuted > 0);
    const half = Math.floor(ok.length / 2);
    const rate = (xs: typeof ok) => xs.reduce((s, b) => s + b.remoteCacheHits, 0) / xs.reduce((s, b) => s + b.actionsExecuted, 0);
    expect(rate(ok.slice(half))).toBeGreaterThan(rate(ok.slice(0, half)));
  });

  it('produces test runs including a flaky/failing test, unique per invocation and label', () => {
    expect(testRuns.length).toBeGreaterThan(9);
    expect(testRuns.some((t) => t.label === '//web:e2e_test' && t.status !== 'passed')).toBe(true);
    const keys = testRuns.map((t) => `${t.invocationId}|${t.label}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
