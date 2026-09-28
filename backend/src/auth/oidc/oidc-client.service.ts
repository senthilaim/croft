import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as client from 'openid-client';

export interface OidcAuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcIdentity {
  email: string;
  name: string;
  subject: string;
}

/**
 * The one place OIDC_* env vars are read. Unlike every other secret in this app, SSO is
 * genuinely optional -- a self-hoster who never wants it should still get a fully working Croft.
 * So this uses `configService.get()` (no default, may be undefined), not `.getOrThrow()`, and the
 * app boots fine either way. Every OIDC operation calls a method that throws a clear 503 if
 * unconfigured instead of crashing -- mirrors StripeClientService (backend/src/billing/).
 */
@Injectable()
export class OidcClientService {
  private configuration: Promise<client.Configuration> | null = null;

  constructor(private readonly configService: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('OIDC_ISSUER_URL') &&
        this.configService.get<string>('OIDC_CLIENT_ID') &&
        this.configService.get<string>('OIDC_CLIENT_SECRET'),
    );
  }

  get displayName(): string {
    return this.configService.get<string>('OIDC_DISPLAY_NAME') ?? 'SSO';
  }

  /** The one redirect URI registered with the IdP -- always recomputed from FRONTEND_ORIGIN, on
   * both the authorize and token-exchange legs, never taken from a caller. Mirrors
   * frontendUrl() in backend/src/billing/billing.controller.ts. */
  private redirectUri(): string {
    const origin = this.configService.get<string>('FRONTEND_ORIGIN', 'http://localhost:3000');
    return `${origin}/api/auth/oidc/callback`;
  }

  private async getConfiguration(): Promise<client.Configuration> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException("Single sign-on isn't configured on this Croft instance.");
    }
    if (!this.configuration) {
      const issuerUrl = this.configService.get<string>('OIDC_ISSUER_URL')!;
      const clientId = this.configService.get<string>('OIDC_CLIENT_ID')!;
      const clientSecret = this.configService.get<string>('OIDC_CLIENT_SECRET')!;
      // Discovery result (including the issuer's JWKS) is cached on this singleton service for
      // the life of the process -- don't cache a failed attempt, so a transient IdP outage at
      // boot doesn't wedge SSO until restart.
      this.configuration = client.discovery(new URL(issuerUrl), clientId, clientSecret).catch((err: unknown) => {
        this.configuration = null;
        throw err;
      });
    }
    return this.configuration;
  }

  /** State/nonce/PKCE are generated here (not in the Next.js route) because openid-client's own
   * helpers guarantee spec-correct entropy/encoding for free -- reimplementing PKCE's S256
   * challenge by hand in a different runtime would just be redoing this library's job. Nothing is
   * persisted server-side (this whole auth system is stateless, see AuthService); the caller is
   * responsible for round-tripping these three values through short-lived httpOnly cookies and
   * handing them back on the callback leg. */
  async buildAuthorizationRequest(): Promise<OidcAuthorizationRequest> {
    const configuration = await this.getConfiguration();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: this.redirectUri(),
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return { url: url.toString(), state, nonce, codeVerifier };
  }

  async exchangeCode(params: { code: string; state: string; codeVerifier: string; nonce: string }): Promise<OidcIdentity> {
    const configuration = await this.getConfiguration();

    const callbackUrl = new URL(this.redirectUri());
    callbackUrl.searchParams.set('code', params.code);
    callbackUrl.searchParams.set('state', params.state);

    let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
    try {
      tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: params.state,
        expectedNonce: params.nonce,
        pkceCodeVerifier: params.codeVerifier,
      });
    } catch {
      throw new UnauthorizedException('Single sign-on failed -- the authorization response could not be verified.');
    }

    const claims = tokens.claims();
    if (!claims) throw new UnauthorizedException('Single sign-on failed -- no identity was returned.');

    let { email, name } = readIdentityClaims(claims);

    // Not every provider puts email/name in the id_token even with the email/profile scopes
    // requested -- fall back to the userinfo endpoint rather than assuming this one specific
    // provider's behavior, since this is meant to work against any generic OIDC issuer.
    if (!email) {
      const userInfo = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);
      email = typeof userInfo.email === 'string' ? userInfo.email : undefined;
      name = name ?? (typeof userInfo.name === 'string' ? userInfo.name : undefined);
    }
    if (!email) {
      throw new UnauthorizedException('Single sign-on failed -- your identity provider did not provide an email address.');
    }

    return { email, name: name ?? email.split('@')[0], subject: claims.sub };
  }
}

/** Pure (no network) so it's directly unit-testable without a real signed id_token: given an
 * already-verified claims set (signature/nonce/state checks all happened inside
 * authorizationCodeGrant before this is called), decide whether the email claim is usable at all,
 * and reject an explicitly-unverified email outright before any account lookup happens. */
export function readIdentityClaims(claims: {
  email_verified?: unknown;
  email?: unknown;
  name?: unknown;
  [claim: string]: unknown;
}): {
  email: string | undefined;
  name: string | undefined;
} {
  if (claims.email_verified === false) {
    throw new UnauthorizedException("Single sign-on failed -- your identity provider account's email is not verified.");
  }
  return {
    email: typeof claims.email === 'string' ? claims.email : undefined,
    name: typeof claims.name === 'string' ? claims.name : undefined,
  };
}
