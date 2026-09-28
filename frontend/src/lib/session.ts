import "server-only";
import { cookies } from "next/headers";
import type { OidcConfigResponse, User } from "@croft/shared-types";
import { ACCESS_TOKEN_COOKIE, BACKEND_URL } from "./backend";

export async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

export async function getCurrentUser(): Promise<User | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;

  const res = await fetch(`${BACKEND_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as User;
}

/** Public (no session needed) -- lets signin/signup pages decide whether to render the "Continue
 * with SSO" button, fetched server-side to avoid a client-side fetch/flash. Falls back to
 * disabled rather than throwing if the backend is briefly unreachable -- an auth page must still
 * render its password form either way. */
export async function getOidcConfig(): Promise<OidcConfigResponse> {
  try {
    const res = await fetch(`${BACKEND_URL}/auth/oidc/config`, { cache: "no-store" });
    if (!res.ok) return { enabled: false, displayName: "SSO" };
    return (await res.json()) as OidcConfigResponse;
  } catch {
    return { enabled: false, displayName: "SSO" };
  }
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await getAccessToken();
  return fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
}
