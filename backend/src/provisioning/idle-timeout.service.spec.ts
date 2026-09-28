import { describe, expect, it, vi } from 'vitest';
import type { BuildfarmInstance } from '@croft/shared-types';
import { IdleTimeoutService } from './idle-timeout.service.js';

const DECRYPTED = {
  doc: {
    roleArn: 'arn:aws:iam::123456789012:role/CroftBuildfarmProvisioner',
    externalId: 'ext-123',
    bootstrapAccessKeyId: 'AKIA',
    region: 'us-east-1',
    allowedIngressCidrs: ['203.0.113.5/32'],
  },
  bootstrapSecretAccessKey: 'secret',
};

function runningAwsInstance(overrides: Partial<BuildfarmInstance> = {}): BuildfarmInstance {
  return {
    workspaceId: 'ws1',
    provider: 'aws',
    ports: { grpc: 8980 },
    host: '1.2.3.4',
    status: 'running',
    lastError: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildService(overrides: {
  credentials?: Array<{ workspaceId: string; idleTimeoutMinutes: number }>;
  instance?: BuildfarmInstance | null;
  lastBuildStartTime?: string | null;
  decrypted?: typeof DECRYPTED | null;
}) {
  const decrypted = 'decrypted' in overrides ? overrides.decrypted : DECRYPTED;
  const cloudCredentialsService = {
    listAllStagingCredentials: vi.fn(async () => overrides.credentials ?? []),
    getDecryptedSecret: vi.fn(async () => decrypted),
  };
  const provisioningService = {
    status: vi.fn(async (_workspaceId: string) => overrides.instance ?? null),
    teardown: vi.fn(async (_workspaceId: string, _awsCredential?: unknown) =>
      runningAwsInstance({ status: 'stopped', host: null }),
    ),
  };
  const buildfarmConfigService = {
    setStatus: vi.fn(async () => undefined),
  };
  const buildsService = {
    findLatestStartTime: vi.fn(async () => overrides.lastBuildStartTime ?? null),
  };
  const service = new IdleTimeoutService(
    cloudCredentialsService as never,
    provisioningService as never,
    buildfarmConfigService as never,
    buildsService as never,
  );
  return { service, cloudCredentialsService, provisioningService, buildfarmConfigService, buildsService };
}

describe('IdleTimeoutService.checkAll', () => {
  it('does nothing when no AWS staging credentials are connected anywhere', async () => {
    const { service, provisioningService } = buildService({ credentials: [] });
    await service.checkAll();
    expect(provisioningService.status).not.toHaveBeenCalled();
  });

  it('skips a workspace whose current instance is not a running AWS instance', async () => {
    const { service, provisioningService } = buildService({
      credentials: [{ workspaceId: 'ws1', idleTimeoutMinutes: 30 }],
      instance: runningAwsInstance({ status: 'stopped' }),
    });
    await service.checkAll();
    expect(provisioningService.teardown).not.toHaveBeenCalled();
  });

  it('skips a Docker instance even if somehow a stale AWS credential still references it', async () => {
    const { service, provisioningService } = buildService({
      credentials: [{ workspaceId: 'ws1', idleTimeoutMinutes: 30 }],
      instance: runningAwsInstance({ provider: 'docker' }),
    });
    await service.checkAll();
    expect(provisioningService.teardown).not.toHaveBeenCalled();
  });

  it('does not tear down when idle time is under the workspace-configured threshold', async () => {
    const recentBuild = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 minutes ago
    const { service, provisioningService } = buildService({
      credentials: [{ workspaceId: 'ws1', idleTimeoutMinutes: 30 }],
      instance: runningAwsInstance(),
      lastBuildStartTime: recentBuild,
    });
    await service.checkAll();
    expect(provisioningService.teardown).not.toHaveBeenCalled();
  });

  it('tears down and marks the config stopped once idle time reaches the configured threshold', async () => {
    const oldBuild = new Date(Date.now() - 45 * 60_000).toISOString(); // 45 minutes ago
    const { service, provisioningService, buildfarmConfigService } = buildService({
      credentials: [{ workspaceId: 'ws1', idleTimeoutMinutes: 30 }],
      instance: runningAwsInstance(),
      lastBuildStartTime: oldBuild,
    });
    await service.checkAll();

    expect(provisioningService.teardown).toHaveBeenCalledTimes(1);
    const [workspaceId, awsCredential] = provisioningService.teardown.mock.calls[0]!;
    expect(workspaceId).toBe('ws1');
    expect(awsCredential).toMatchObject({ roleArn: DECRYPTED.doc.roleArn, bootstrapSecretAccessKey: 'secret' });
    expect(buildfarmConfigService.setStatus).toHaveBeenCalledWith('ws1', 'stopped');
  });

  it('falls back to the instance updatedAt when the workspace has never had a build', async () => {
    const staleUpdatedAt = new Date(Date.now() - 45 * 60_000).toISOString();
    const { service, provisioningService } = buildService({
      credentials: [{ workspaceId: 'ws1', idleTimeoutMinutes: 30 }],
      instance: runningAwsInstance({ updatedAt: staleUpdatedAt }),
      lastBuildStartTime: null,
    });
    await service.checkAll();
    expect(provisioningService.teardown).toHaveBeenCalledTimes(1);
  });

  it('does not tear down if the credential was disconnected between listing and the check', async () => {
    const oldBuild = new Date(Date.now() - 999 * 60_000).toISOString();
    const { service, provisioningService } = buildService({
      credentials: [{ workspaceId: 'ws1', idleTimeoutMinutes: 30 }],
      instance: runningAwsInstance(),
      lastBuildStartTime: oldBuild,
      decrypted: null,
    });
    await service.checkAll();
    expect(provisioningService.teardown).not.toHaveBeenCalled();
  });

  it('continues checking other workspaces when one workspace throws', async () => {
    const { service, provisioningService, cloudCredentialsService } = buildService({
      credentials: [
        { workspaceId: 'ws-broken', idleTimeoutMinutes: 30 },
        { workspaceId: 'ws-ok', idleTimeoutMinutes: 30 },
      ],
    });
    provisioningService.status
      .mockRejectedValueOnce(new Error('automation unreachable'))
      .mockResolvedValueOnce(runningAwsInstance({ workspaceId: 'ws-ok', status: 'stopped' }));

    await expect(service.checkAll()).resolves.toBeUndefined();
    expect(provisioningService.status).toHaveBeenCalledTimes(2);
    expect(cloudCredentialsService.listAllStagingCredentials).toHaveBeenCalledTimes(1);
  });
});
