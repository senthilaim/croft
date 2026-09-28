import { NextResponse, type NextRequest } from "next/server";
import type { AuthResponse, OidcCallbackRequest } from "@croft/shared-types";
import { setAuthCookies } from "@/lib/auth-route-helpers";
import {
  BACKEND_URL,
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
} from "@/lib/backend";

function failure(request: NextRequest, error: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/signin?error=${error}`, request.url), { status: 302 });
  res.cookies.delete(OIDC_STATE_COOKIE);
  res.cookies.delete(OIDC_NONCE_COOKIE);
  res.cookies.delete(OIDC_VERIFIER_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return failure(request, "oidc_failed");

  // CSRF check -- must happen before anything else touches the backend. A mismatch (or a missing
  // cookie, e.g. the flow cookies expired or this is a forged callback) fails closed.
  const expectedState = request.cookies.get(OIDC_STATE_COOKIE)?.value;
  const nonce = request.cookies.get(OIDC_NONCE_COOKIE)?.value;
  const codeVerifier = request.cookies.get(OIDC_VERIFIER_COOKIE)?.value;
  if (!expectedState || !nonce || !codeVerifier || state !== expectedState) {
    return failure(request, "oidc_state_mismatch");
  }

  const body: OidcCallbackRequest = { code, state, codeVerifier, nonce };
  const backendRes = await fetch(`${BACKEND_URL}/auth/oidc/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!backendRes.ok) return failure(request, "oidc_failed");

  const auth = (await backendRes.json()) as AuthResponse;
  const res = NextResponse.redirect(new URL("/workspaces", request.url), { status: 302 });
  setAuthCookies(res, auth);
  res.cookies.delete(OIDC_STATE_COOKIE);
  res.cookies.delete(OIDC_NONCE_COOKIE);
  res.cookies.delete(OIDC_VERIFIER_COOKIE);
  return res;
}
