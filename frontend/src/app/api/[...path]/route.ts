import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_TOKEN_COOKIE, BACKEND_URL } from "@/lib/backend";

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  const url = new URL(`${BACKEND_URL}/${path.join("/")}`);
  url.search = request.nextUrl.search;

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const backendRes = await fetch(url, {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: hasBody ? await request.text() : undefined,
  });

  const responseBody = await backendRes.arrayBuffer();
  const headers: Record<string, string> = {
    "Content-Type": backendRes.headers.get("Content-Type") ?? "application/json",
  };
  const contentDisposition = backendRes.headers.get("Content-Disposition");
  if (contentDisposition) headers["Content-Disposition"] = contentDisposition;

  return new NextResponse(responseBody, { status: backendRes.status, headers });
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
