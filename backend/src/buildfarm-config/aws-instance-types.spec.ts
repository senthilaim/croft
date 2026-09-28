import { describe, expect, it } from 'vitest';
import type { BuildfarmNode } from '@croft/shared-types';
import { assertAwsInstanceTypesAllowed } from './aws-instance-types.js';

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

function withWorkerInstanceType(instanceType: string): BuildfarmNode[] {
  return NODES.map((n) => (n.type === 'worker' ? { ...n, config: { ...n.config, instanceType } } : n));
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
