import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  authCookieOptions,
  BACKEND_URL,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
} from "@/lib/backend";

interface RotatedTokens {
  accessToken: string;
  refreshToken: string;
}

/** POST /auth/refresh directly (not through this same proxy -- that would recurse), matching
 * backend/src/auth/auth.controller.ts's { refreshToken } in, { accessToken, refreshToken } out.
 * Refresh rotates the refresh token too, so both cookies get replaced, not just the access one. */
async function tryRefresh(refreshToken: string): Promise<RotatedTokens | null> {
  const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return null;
  return (await res.json()) as RotatedTokens;
}

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  const url = new URL(`${BACKEND_URL}/${path.join("/")}`);
  url.search = request.nextUrl.search;

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.text() : undefined;

  const attempt = (token: string | undefined) =>
    fetch(url, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });

  let backendRes = await attempt(accessToken);

  // The access token is short-lived (15m) by design; rather than forcing a full re-signin every
  // time it expires mid-session, silently refresh once and retry -- the same /auth/refresh flow
  // that already existed at the API level, just not wired into the frontend until now.
  let rotated: RotatedTokens | null = null;
  if (backendRes.status === 401) {
    const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
    if (refreshToken) {
      rotated = await tryRefresh(refreshToken);
      if (rotated) backendRes = await attempt(rotated.accessToken);
    }
  }

  const responseBody = await backendRes.arrayBuffer();
  const headers: Record<string, string> = {
    "Content-Type": backendRes.headers.get("Content-Type") ?? "application/json",
  };
  const contentDisposition = backendRes.headers.get("Content-Disposition");
  if (contentDisposition) headers["Content-Disposition"] = contentDisposition;

  const response = new NextResponse(responseBody, { status: backendRes.status, headers });
  if (rotated) {
    response.cookies.set(ACCESS_TOKEN_COOKIE, rotated.accessToken, authCookieOptions(ACCESS_TOKEN_MAX_AGE));
    response.cookies.set(REFRESH_TOKEN_COOKIE, rotated.refreshToken, authCookieOptions(REFRESH_TOKEN_MAX_AGE));
  }
  // If refresh itself failed (refresh token also expired/invalid), backendRes is still the
  // original 401 -- unchanged, same as before this change. proxy.ts's existing redirect-to-/signin
  // for /workspaces/* already handles that case client-side; nothing new needed here for it.
  return response;
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  return proxy(request, path);
}
