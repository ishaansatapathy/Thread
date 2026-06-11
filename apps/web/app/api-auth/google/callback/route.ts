import { type NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

/** Proxy Google OAuth callback so Set-Cookie headers reach the browser on :3000. */
export async function GET(request: NextRequest) {
  const upstream = `${API_BASE}/auth/google/callback${request.nextUrl.search}`;

  const upstreamRes = await fetch(upstream, {
    redirect: "manual",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });

  const location = upstreamRes.headers.get("location");
  const response = location
    ? NextResponse.redirect(location)
    : new NextResponse(upstreamRes.body, { status: upstreamRes.status });

  appendProxiedSetCookies(response.headers, upstreamRes.headers);

  return response;
}
