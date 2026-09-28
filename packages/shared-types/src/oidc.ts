/** Public capability probe -- lets the frontend decide whether to render the "Continue with SSO"
 * button without needing its own copy of the backend's OIDC env vars (it has none; only the
 * backend ever holds OIDC_CLIENT_SECRET). */
export interface OidcConfigResponse {
  enabled: boolean;
  displayName: string;
}

export interface OidcAuthorizeUrlResponse {
  url: string;
}

export interface OidcCallbackRequest {
  code: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}
