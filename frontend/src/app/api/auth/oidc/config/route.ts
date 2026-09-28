import { NextResponse } from "next/server";
import type { OidcConfigResponse } from "@croft/shared-types";
import { BACKEND_URL } from "@/lib/backend";

// The browser can't reach BACKEND_URL directly -- this is a thin passthrough for any client
// component that wants to re-check without a full page reload. signin/page.tsx and signup/page.tsx
// fetch this same backend endpoint server-side directly instead, to avoid a client-side fetch/flash.
export async function GET() {
  const backendRes = await fetch(`${BACKEND_URL}/auth/oidc/config`, { cache: "no-store" });
  const data = (await backendRes.json()) as OidcConfigResponse;
  return NextResponse.json(data, { status: backendRes.status });
}
