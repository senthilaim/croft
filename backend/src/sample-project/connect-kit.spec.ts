import { describe, expect, it } from 'vitest';
import { buildCiBazelrc, buildConnectKit, isValidHost } from './connect-kit.js';

const base = {
  workspaceId: 'ws1',
  host: 'croft.internal',
  provider: 'github' as const,
  grpcPort: 20001,
  besPort: 9095,
  executionEnabled: true,
  selfHosted: true,
  besToken: 'deadbeef',
};

describe('connect kit', () => {
  it('scopes remote settings to --config=croft with the right endpoints', () => {
    const rc = buildCiBazelrc(base);
    expect(rc).toContain('build:croft --remote_executor=grpc://croft.internal:20001');
    expect(rc).toContain('build:croft --bes_backend=grpc://croft.internal:9095');
    expect(rc).toContain('build:croft --bes_header=x-workspace-id=ws1');
    expect(rc).toContain('build:croft --bes_header=x-workspace-token=deadbeef');
    expect(rc).not.toMatch(/^build --/m);
  });

  it('omits the executor for cache-only workspaces', () => {
    const rc = buildCiBazelrc({ ...base, executionEnabled: false });
    expect(rc).not.toContain('--remote_executor');
    expect(rc).toContain('--remote_cache=grpc://croft.internal:20001');
  });

  it('generates a CI file per provider', () => {
    expect(buildConnectKit(base).files[1].path).toBe('.github/workflows/bazel-croft.yml');
    expect(buildConnectKit({ ...base, provider: 'gitlab' }).files[1].path).toBe('.gitlab-ci.yml');
    expect(buildConnectKit({ ...base, provider: 'jenkins' }).files[1].content).toContain('--config=croft');
  });

  it('warns about loopback hosts, hosted runners, and missing auth', () => {
    const kit = buildConnectKit({ ...base, host: 'localhost', selfHosted: false });
    expect(kit.warnings.some((w) => w.includes('only works from the machine running Croft'))).toBe(true);
    expect(kit.warnings.some((w) => w.includes('GitHub-hosted runners'))).toBe(true);
    expect(kit.warnings.some((w) => w.includes('no authentication'))).toBe(true);
    expect(buildConnectKit(base).warnings).toHaveLength(1);
  });

  it('accepts hostnames and IPs but rejects anything that could break out of the config', () => {
    for (const ok of ['localhost', 'croft.internal', '10.0.0.5', 'a-b.example.com']) {
      expect(isValidHost(ok)).toBe(true);
    }
    for (const bad of ['', 'a b', 'x;rm -rf', 'host\nbuild --x', 'a/b', '-lead', 'trail-']) {
      expect(isValidHost(bad)).toBe(false);
    }
  });
});
