export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000/api";

export const ACCESS_TOKEN_COOKIE = "bf_access_token";
export const REFRESH_TOKEN_COOKIE = "bf_refresh_token";

export const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 minutes, matches backend access token TTL
export const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, matches backend refresh token TTL

// Short-lived, cleared as soon as the OIDC callback runs (or expire on their own if the user never
// completes the redirect) -- round-trip state/nonce/PKCE verifier through the browser since the
// backend itself is stateless and holds nothing between the authorize and callback legs.
export const OIDC_STATE_COOKIE = "bf_oidc_state";
export const OIDC_NONCE_COOKIE = "bf_oidc_nonce";
export const OIDC_VERIFIER_COOKIE = "bf_oidc_verifier";
export const OIDC_FLOW_MAX_AGE = 10 * 60; // 10 minutes -- generous for a login redirect, no longer

export function authCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Secure cookies are dropped by some browsers (Safari) on plain http://localhost, which is how
    // the self-hosted container install is served. Set COOKIE_SECURE=true behind TLS.
    secure: (process.env.COOKIE_SECURE ?? String(process.env.NODE_ENV === "production")) === "true",
    path: "/",
    maxAge,
  };
}
