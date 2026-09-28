import { describe, expect, it } from 'vitest';
import { UsersService } from './users.service.js';

function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
}

describe('UsersService.createFromOidc', () => {
  it('creates a user with no passwordHash and the oidc provider/subject set', async () => {
    const calls: unknown[] = [];
    const userModel = {
      create: (doc: unknown) => {
        calls.push(doc);
        return Promise.resolve({ id: 'u1', ...(doc as object) });
      },
    };
    const service = new UsersService(userModel as never);

    const user = await service.createFromOidc('sso@example.com', 'SSO User', 'idp-subject-123');

    expect(calls).toEqual([
      { email: 'sso@example.com', name: 'SSO User', authProvider: 'oidc', oidcSubject: 'idp-subject-123' },
    ]);
    expect((user as never as { passwordHash?: string }).passwordHash).toBeUndefined();
  });

  it('surfaces a duplicate email as the same ConflictException create() throws', async () => {
    const userModel = { create: () => Promise.reject(duplicateKeyError()) };
    const service = new UsersService(userModel as never);

    await expect(service.createFromOidc('taken@example.com', 'Name', 'sub')).rejects.toThrow(
      'An account with this email already exists',
    );
  });
});

describe('UsersService.create -- sets authProvider: password', () => {
  it('passes authProvider: password through to the model', async () => {
    const calls: unknown[] = [];
    const userModel = {
      create: (doc: unknown) => {
        calls.push(doc);
        return Promise.resolve({ id: 'u1', ...(doc as object) });
      },
    };
    const service = new UsersService(userModel as never);

    await service.create('user@example.com', 'hashed', 'User');

    expect(calls).toEqual([{ email: 'user@example.com', passwordHash: 'hashed', name: 'User', authProvider: 'password' }]);
  });
});
