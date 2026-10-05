import { describe, expect, it } from 'vitest';
import type { BuildfarmNode, RemoteCacheTier } from '@croft/shared-types';
import { assertAwsInstanceTypesAllowed, assertRemoteCacheTierAllowed } from './aws-instance-types.js';

const NODES: BuildfarmNode[] = [
  { id: 'server-1', type: 'server', position: { x: 0, y: 0 }, config: { cpuLimit: '1', memoryLimitMb: 512 } },
  {
    id: 'worker-1',
    type: 'worker',
    position: { x: 0, y: 0 },
    config: { cpuLimit: '1', memoryLimitMb: 1024, replicas: 1, executionEnabled: true },
  },
  { id: 'redis-1', type: 'redis', position: { x: 0, y: 0 }, config: { memoryLimitMb: 256 } },
];

const NODES_WITH_CACHE: BuildfarmNode[] = [...NODES, { id: 'cache-1', type: 'cache', position: { x: 0, y: 0 }, config: { sizeGb: 10 } }];

function withWorkerInstanceType(instanceType: string): BuildfarmNode[] {
  return NODES.map((n) => (n.type === 'worker' ? { ...n, config: { ...n.config, instanceType } } : n));
}

function withCacheTier(tier: RemoteCacheTier): BuildfarmNode[] {
  return NODES_WITH_CACHE.map((n) => (n.type === 'cache' ? { ...n, config: { ...n.config, remoteCacheTier: tier } } : n));
}

describe('assertAwsInstanceTypesAllowed', () => {
  it('allows an AWS design with no instanceType set on any node (falls back to AwsBackend default)', () => {
    expect(() => assertAwsInstanceTypesAllowed('aws', NODES)).not.toThrow();
  });

  it('allows an AWS design using an allowlisted instance type', () => {
    expect(() => assertAwsInstanceTypesAllowed('aws', withWorkerInstanceType('c6i.large'))).not.toThrow();
    expect(() => assertAwsInstanceTypesAllowed('aws', withWorkerInstanceType('m6i.large'))).not.toThrow();
  });

  it('rejects an AWS design requesting an instance type outside the staging allowlist', () => {
    expect(() => assertAwsInstanceTypesAllowed('aws', withWorkerInstanceType('m6i.4xlarge'))).toThrow(
      /Unsupported AWS instance type/,
    );
  });

  it('does not enforce the allowlist for a Docker design, even with a bogus instanceType value', () => {
    expect(() => assertAwsInstanceTypesAllowed('docker', withWorkerInstanceType('not-a-real-type'))).not.toThrow();
  });
});

describe('assertRemoteCacheTierAllowed', () => {
  it('allows a Docker design with no remote cache tier set', () => {
    expect(() => assertRemoteCacheTierAllowed('docker', NODES_WITH_CACHE)).not.toThrow();
  });

  it('allows a Docker design using the "local" tier', () => {
    expect(() => assertRemoteCacheTierAllowed('docker', withCacheTier('local'))).not.toThrow();
  });

  it('rejects a Docker design requesting the "s3" or "both" tier', () => {
    expect(() => assertRemoteCacheTierAllowed('docker', withCacheTier('s3'))).toThrow(/needs AWS/);
    expect(() => assertRemoteCacheTierAllowed('docker', withCacheTier('both'))).toThrow(/needs AWS/);
  });

  it('allows any tier on an AWS design', () => {
    expect(() => assertRemoteCacheTierAllowed('aws', withCacheTier('local'))).not.toThrow();
    expect(() => assertRemoteCacheTierAllowed('aws', withCacheTier('s3'))).not.toThrow();
    expect(() => assertRemoteCacheTierAllowed('aws', withCacheTier('both'))).not.toThrow();
  });

  it('ignores remoteCacheTier-shaped fields on non-cache nodes', () => {
    const nodes = NODES.map((n) =>
      n.type === 'worker' ? { ...n, config: { ...n.config, remoteCacheTier: 's3' } } : n,
    );
    expect(() => assertRemoteCacheTierAllowed('docker', nodes)).not.toThrow();
  });
});
