import { describe, expect, it } from 'vitest';
import { OidcService } from './oidc.service.js';

const IDENTITY = { email: 'user@example.com', name: 'A User', subject: 'idp-subject-1' };

function oidcClientStub() {
  return { exchangeCode: () => Promise.resolve(IDENTITY) };
}

function authServiceStub() {
  const calls: unknown[] = [];
  return {
    calls,
    buildAuthResponse: (user: unknown) => {
      calls.push(user);
      return Promise.resolve({ accessToken: 'a', refreshToken: 'r', user: { id: (user as { id: string }).id } });
    },
  };
}

describe('OidcService.handleCallback -- account resolution', () => {
  it('creates a new User when no account exists under this email', async () => {
    const createFromOidcCalls: unknown[] = [];
    const usersService = {
      findByEmail: () => Promise.resolve(null),
      createFromOidc: (email: string, name: string, subject: string) => {
        createFromOidcCalls.push([email, name, subject]);
        return Promise.resolve({ id: 'new-user-id' });
      },
    };
    const authService = authServiceStub();
    const svc = new OidcService(oidcClientStub() as never, usersService as never, authService as never);

    const result = await svc.handleCallback({ code: 'c', state: 's', codeVerifier: 'v', nonce: 'n' });

    expect(createFromOidcCalls).toEqual([['user@example.com', 'A User', 'idp-subject-1']]);
    expect(result.user.id).toBe('new-user-id');
  });

  it('resolves to the SAME User.id for an existing password account under this email -- does not create a duplicate', async () => {
    const existingUser = { id: 'existing-password-user-id', email: 'user@example.com', passwordHash: 'hashed' };
    const createFromOidc = () => {
      throw new Error('should not be called -- an account already exists under this email');
    };
    const usersService = { findByEmail: () => Promise.resolve(existingUser), createFromOidc };
    const authService = authServiceStub();
    const svc = new OidcService(oidcClientStub() as never, usersService as never, authService as never);

    const result = await svc.handleCallback({ code: 'c', state: 's', codeVerifier: 'v', nonce: 'n' });

    expect(result.user.id).toBe('existing-password-user-id');
    expect(authService.calls).toEqual([existingUser]);
  });

  it('resolves to the same User.id on a second login by an already-OIDC-linked account', async () => {
    const existingUser = { id: 'existing-oidc-user-id', email: 'user@example.com', authProvider: 'oidc' };
    const createFromOidc = () => {
      throw new Error('should not be called -- already linked');
    };
    const usersService = { findByEmail: () => Promise.resolve(existingUser), createFromOidc };
    const authService = authServiceStub();
    const svc = new OidcService(oidcClientStub() as never, usersService as never, authService as never);

    const result = await svc.handleCallback({ code: 'c', state: 's', codeVerifier: 'v', nonce: 'n' });

    expect(result.user.id).toBe('existing-oidc-user-id');
  });
});

describe('OidcService.config', () => {
  it('reflects OidcClientService.isConfigured/displayName', () => {
    const oidcClient = { isConfigured: true, displayName: 'Okta' };
    const svc = new OidcService(oidcClient as never, {} as never, {} as never);
    expect(svc.config).toEqual({ enabled: true, displayName: 'Okta' });
  });
});
