import { describe, expect, it } from 'vitest';
import { OidcClientService, readIdentityClaims } from './oidc-client.service.js';

function serviceWith(overrides: Record<string, string | undefined>): OidcClientService {
  const configValues: Record<string, string | undefined> = {
    OIDC_ISSUER_URL: undefined,
    OIDC_CLIENT_ID: undefined,
    OIDC_CLIENT_SECRET: undefined,
    OIDC_DISPLAY_NAME: undefined,
    FRONTEND_ORIGIN: 'http://localhost:3000',
    ...overrides,
  };
  const configService = {
    get: (key: string, defaultValue?: string) => configValues[key] ?? defaultValue,
  };
  return new OidcClientService(configService as never);
}

describe('OidcClientService.isConfigured', () => {
  it('is false with no OIDC env vars set', () => {
    expect(serviceWith({}).isConfigured).toBe(false);
  });

  it('is false when only some of the three required vars are set', () => {
    expect(serviceWith({ OIDC_ISSUER_URL: 'https://idp.example.com' }).isConfigured).toBe(false);
    expect(
      serviceWith({ OIDC_ISSUER_URL: 'https://idp.example.com', OIDC_CLIENT_ID: 'client-1' }).isConfigured,
    ).toBe(false);
  });

  it('is true once issuer, client id, and client secret are all set', () => {
    const svc = serviceWith({
      OIDC_ISSUER_URL: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'client-1',
      OIDC_CLIENT_SECRET: 'secret-1',
    });
    expect(svc.isConfigured).toBe(true);
  });
});

describe('OidcClientService.displayName', () => {
  it('defaults to "SSO" when unset', () => {
    expect(serviceWith({}).displayName).toBe('SSO');
  });

  it('uses OIDC_DISPLAY_NAME when set', () => {
    expect(serviceWith({ OIDC_DISPLAY_NAME: 'Okta' }).displayName).toBe('Okta');
  });
});

describe('OidcClientService -- unconfigured gate', () => {
  it('buildAuthorizationRequest throws a 503 rather than attempting discovery when unconfigured', async () => {
    await expect(serviceWith({}).buildAuthorizationRequest()).rejects.toThrow(
      "Single sign-on isn't configured on this Croft instance.",
    );
  });

  it('exchangeCode throws the same 503 when unconfigured', async () => {
    await expect(
      serviceWith({}).exchangeCode({ code: 'x', state: 'x', codeVerifier: 'x', nonce: 'x' }),
    ).rejects.toThrow("Single sign-on isn't configured on this Croft instance.");
  });

  it('once configured, buildAuthorizationRequest gets past the gate and attempts real discovery (fails on network, not on the config check)', async () => {
    const svc = serviceWith({
      // A syntactically valid but non-resolving issuer -- proves the isConfigured gate let the
      // call through to the real openid-client discovery call, which then fails for a genuinely
      // different reason (network/DNS), not "unconfigured".
      OIDC_ISSUER_URL: 'https://oidc-issuer-that-does-not-exist.invalid',
      OIDC_CLIENT_ID: 'client-1',
      OIDC_CLIENT_SECRET: 'secret-1',
    });
    await expect(svc.buildAuthorizationRequest()).rejects.not.toThrow(
      "Single sign-on isn't configured on this Croft instance.",
    );
  });
});

describe('readIdentityClaims -- no network, pure claims validation', () => {
  it('rejects an explicitly-unverified email before any account lookup would happen', () => {
    expect(() => readIdentityClaims({ email: 'user@example.com', email_verified: false })).toThrow(
      /email is not verified/,
    );
  });

  it('accepts a verified email', () => {
    expect(readIdentityClaims({ email: 'user@example.com', email_verified: true, name: 'A User' })).toEqual({
      email: 'user@example.com',
      name: 'A User',
    });
  });

  it('accepts an id_token with no email_verified claim at all -- many providers omit it and always verify email', () => {
    expect(readIdentityClaims({ email: 'user@example.com' })).toEqual({ email: 'user@example.com', name: undefined });
  });

  it('returns undefined email/name (not a throw) when the id_token carries neither -- caller falls back to userinfo', () => {
    expect(readIdentityClaims({})).toEqual({ email: undefined, name: undefined });
  });
});
