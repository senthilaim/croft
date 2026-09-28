import { NextResponse, type NextRequest } from "next/server";
import type { OidcAuthorizeUrlResponse } from "@croft/shared-types";
import {
  authCookieOptions,
  BACKEND_URL,
  OIDC_FLOW_MAX_AGE,
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
} from "@/lib/backend";

export async function GET(request: NextRequest) {
  const backendRes = await fetch(`${BACKEND_URL}/auth/oidc/authorize-url`, { cache: "no-store" });
  if (!backendRes.ok) {
    return NextResponse.redirect(new URL("/signin?error=oidc_failed", request.url), { status: 302 });
  }

  const data = (await backendRes.json()) as OidcAuthorizeUrlResponse & {
    state: string;
    nonce: string;
    codeVerifier: string;
  };

  const res = NextResponse.redirect(data.url, { status: 302 });
  const cookieOptions = authCookieOptions(OIDC_FLOW_MAX_AGE);
  res.cookies.set(OIDC_STATE_COOKIE, data.state, cookieOptions);
  res.cookies.set(OIDC_NONCE_COOKIE, data.nonce, cookieOptions);
  res.cookies.set(OIDC_VERIFIER_COOKIE, data.codeVerifier, cookieOptions);
  return res;
}
