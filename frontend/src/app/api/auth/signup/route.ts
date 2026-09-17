import type { NextRequest } from "next/server";
import { forwardAuthRequest } from "@/lib/auth-route-helpers";

export async function POST(request: NextRequest) {
  const body = await request.json();
  return forwardAuthRequest("/auth/signup", body);
}
