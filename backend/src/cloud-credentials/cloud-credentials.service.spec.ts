import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { ConnectCloudCredentialRequest } from '@croft/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenCipherService } from '../crypto/token-cipher.service.js';
import { CloudCredentialsService } from './cloud-credentials.service.js';

const TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

function tokenCipher(): TokenCipherService {
  const config = { getOrThrow: () => TOKEN_ENCRYPTION_KEY } as unknown as ConfigService;
  return new TokenCipherService(config);
}

function automationConfig(): ConfigService {
  const values: Record<string, string> = {
    AUTOMATION_SERVICE_URL: 'http://automation.test',
    AUTOMATION_INTERNAL_TOKEN: 'internal-token',
  };
  return { getOrThrow: (key: string) => values[key] } as unknown as ConfigService;
}

function fakeModel(savedDoc: Record<string, unknown> = {}) {
  const doc = { createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...savedDoc };
  return {
    findOneAndUpdate: vi.fn(async (_filter: Record<string, unknown>, _update: Record<string, unknown>) => doc),
    findOne: vi.fn(() => ({ exec: async () => null })),
    deleteOne: vi.fn(() => ({ exec: async () => undefined })),
  };
}

const VALID_REQUEST: ConnectCloudCredentialRequest = {
  roleArn: 'arn:aws:iam::123456789012:role/CroftBuildfarmProvisioner',
  bootstrapAccessKeyId: 'AKIAABCDEFGHIJKLMNOP',
  bootstrapSecretAccessKey: 'super-secret-key',
  environment: 'staging',
  region: 'us-east-1',
  idleTimeoutMinutes: 60,
  allowedIngressCidrs: ['198.18.3.5/32'], // RFC 2544 benchmarking range -- real-shaped but not a documentation range
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CloudCredentialsService.connect -- rejection paths', () => {
  it('rejects a non-staging environment before calling automation or encrypting anything', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const model = fakeModel();
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());

    await expect(
      service.connect('ws1', 'user1', { ...VALID_REQUEST, environment: 'production' }),
    ).rejects.toThrow(/staging/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects an unsupported region', async () => {
    const model = fakeModel();
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());
    await expect(service.connect('ws1', 'user1', { ...VALID_REQUEST, region: 'eu-west-1' })).rejects.toThrow(
      /us-east-1/,
    );
  });

  it('rejects an idle timeout outside the platform range', async () => {
    const model = fakeModel();
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());
    await expect(
      service.connect('ws1', 'user1', { ...VALID_REQUEST, idleTimeoutMinutes: 5 }),
    ).rejects.toThrow(/between 30 and 240/);
    await expect(
      service.connect('ws1', 'user1', { ...VALID_REQUEST, idleTimeoutMinutes: 1000 }),
    ).rejects.toThrow(/between 30 and 240/);
  });

  it('rejects an empty allowedIngressCidrs list', async () => {
    const model = fakeModel();
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());
    await expect(
      service.connect('ws1', 'user1', { ...VALID_REQUEST, allowedIngressCidrs: [] }),
    ).rejects.toThrow(/allowed ingress/);
  });

  it('rejects a 0.0.0.0/0 ingress CIDR even alongside a valid one', async () => {
    const model = fakeModel();
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());
    await expect(
      service.connect('ws1', 'user1', {
        ...VALID_REQUEST,
        allowedIngressCidrs: ['198.18.3.5/32', '0.0.0.0/0'],
      }),
    ).rejects.toThrow(/0\.0\.0\.0\/0/);
  });

  it('rejects the connect form\'s own documentation/example placeholder CIDR', async () => {
    const model = fakeModel();
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());
    await expect(
      service.connect('ws1', 'user1', { ...VALID_REQUEST, allowedIngressCidrs: ['203.0.113.5/32'] }),
    ).rejects.toThrow(/documentation\/example range/);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('CloudCredentialsService.connect -- validate-before-store', () => {
  it('calls automation to validate the role before encrypting and storing anything', async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ assumedRoleArn: 'arn:aws:sts::123:assumed-role/x' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const model = fakeModel({
      ...VALID_REQUEST,
      workspaceId: 'ws1',
      provider: 'aws',
      externalId: 'ext',
      bootstrapKeyLast4: VALID_REQUEST.bootstrapAccessKeyId.slice(-4),
    });
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());

    const result = await service.connect('ws1', 'user1', VALID_REQUEST);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://automation.test/credentials/validate');
    const body = JSON.parse(init!.body as string);
    expect(body.roleArn).toBe(VALID_REQUEST.roleArn);
    expect(body.bootstrapSecretAccessKey).toBe(VALID_REQUEST.bootstrapSecretAccessKey);

    // The bootstrap secret is encrypted before being persisted -- never written to Mongo in the clear.
    const [, writeArgs] = model.findOneAndUpdate.mock.calls[0]!;
    expect(writeArgs.bootstrapSecretCiphertext).toBeDefined();
    expect(writeArgs.bootstrapSecretCiphertext).not.toBe(VALID_REQUEST.bootstrapSecretAccessKey);
    expect(result.bootstrapKeyLast4).toBe(VALID_REQUEST.bootstrapAccessKeyId.slice(-4));
  });

  it('rejects and never encrypts/stores when automation reports the role is not assumable', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ detail: 'AccessDenied assuming role' }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const model = fakeModel();
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());

    await expect(service.connect('ws1', 'user1', VALID_REQUEST)).rejects.toThrow(/AccessDenied/);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('surfaces an unreachable automation service as a clear error, not a raw exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const model = fakeModel();
    const service = new CloudCredentialsService(model as never, tokenCipher(), automationConfig());

    await expect(service.connect('ws1', 'user1', VALID_REQUEST)).rejects.toThrow(/Could not reach/);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('CloudCredentialsService.getSetupInfo', () => {
  it('is stable across calls for the same workspace and embeds the external id in the trust policy', () => {
    const service = new CloudCredentialsService(fakeModel() as never, tokenCipher(), automationConfig());
    const first = service.getSetupInfo('ws1');
    const second = service.getSetupInfo('ws1');
    expect(first.externalId).toBe(second.externalId);
    expect(first.trustPolicyJson).toContain(first.externalId);
  });

  it('derives a different external id for a different workspace', () => {
    const service = new CloudCredentialsService(fakeModel() as never, tokenCipher(), automationConfig());
    expect(service.getSetupInfo('ws1').externalId).not.toBe(service.getSetupInfo('ws2').externalId);
  });
});
