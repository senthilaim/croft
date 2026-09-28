import { describe, expect, it } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import type { UserDocument } from '../users/schemas/user.schema.js';

const INVALID_MESSAGE = 'Invalid email or password';

function usersServiceWith(user: Partial<UserDocument> | null) {
  return { findByEmail: () => Promise.resolve(user as UserDocument | null) };
}

const jwtServiceStub = { signAsync: () => Promise.resolve('signed-token') };
const configServiceStub = { getOrThrow: () => 'test-secret' };

function service(user: Partial<UserDocument> | null): AuthService {
  return new AuthService(usersServiceWith(user) as never, jwtServiceStub as never, configServiceStub as never);
}

describe('AuthService.signin -- no account-enumeration leakage', () => {
  it('rejects a nonexistent account with the generic message', async () => {
    await expect(service(null).signin('nobody@example.com', 'whatever')).rejects.toThrow(INVALID_MESSAGE);
  });

  it('rejects an OIDC-only account (no passwordHash) with the exact same generic message, not a crash', async () => {
    const svc = service({ id: 'u1', email: 'sso@example.com', passwordHash: undefined });
    await expect(svc.signin('sso@example.com', 'whatever')).rejects.toThrow(INVALID_MESSAGE);
  });

  it('rejects a wrong password with the same generic message', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const svc = service({ id: 'u1', email: 'user@example.com', passwordHash });
    await expect(svc.signin('user@example.com', 'wrong-password')).rejects.toThrow(INVALID_MESSAGE);
  });

  it('all three rejection paths throw the exact same message, not just "some error"', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const results = await Promise.allSettled([
      service(null).signin('nobody@example.com', 'x'),
      service({ id: 'u1', email: 'sso@example.com', passwordHash: undefined }).signin('sso@example.com', 'x'),
      service({ id: 'u1', email: 'user@example.com', passwordHash }).signin('user@example.com', 'wrong'),
    ]);
    const messages = results.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : null));
    expect(messages).toEqual([INVALID_MESSAGE, INVALID_MESSAGE, INVALID_MESSAGE]);
  });
});

describe('AuthService.signin -- happy path is unaffected', () => {
  it('succeeds for a password account with the correct password', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const svc = service({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      passwordHash,
      createdAt: new Date('2026-01-01'),
    } as never);
    const result = await svc.signin('user@example.com', 'correct-password');
    expect(result.user.email).toBe('user@example.com');
    expect(result.accessToken).toBe('signed-token');
  });
});
