import { NextResponse } from "next/server";
import type { AuthResponse } from "@croft/shared-types";
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  authCookieOptions,
  BACKEND_URL,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
} from "./backend";

export async function forwardAuthRequest(backendPath: string, body: unknown) {
  const backendRes = await fetch(`${BACKEND_URL}${backendPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await backendRes.json().catch(() => ({}))) as
    | AuthResponse
    | { message?: string };

  if (!backendRes.ok) {
    return NextResponse.json(data, { status: backendRes.status });
  }

  const auth = data as AuthResponse;
  const res = NextResponse.json({ user: auth.user });
  res.cookies.set(ACCESS_TOKEN_COOKIE, auth.accessToken, authCookieOptions(ACCESS_TOKEN_MAX_AGE));
  res.cookies.set(
    REFRESH_TOKEN_COOKIE,
    auth.refreshToken,
    authCookieOptions(REFRESH_TOKEN_MAX_AGE),
  );
  return res;
}
