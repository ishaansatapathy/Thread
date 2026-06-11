import { NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

/** Refresh session cookies via auth.me — use when client tRPC session sync fails. */
export async function GET(request: NextRequest) {
  const cookie = request.headers.get("cookie") ?? "";

  try {
    const upstreamRes = await fetch(`${API_BASE}/trpc/auth.me?input=%7B%7D`, {
      headers: {
        ...(cookie ? { cookie } : {}),
        "accept-encoding": "identity",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

    const bodyText = await upstreamRes.text();
    const response = new NextResponse(bodyText, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: {
        "content-type": upstreamRes.headers.get("content-type") ?? "application/json",
      },
    });

    appendProxiedSetCookies(response.headers, upstreamRes.headers);

    return response;
  } catch {
    return NextResponse.json(
      { error: { message: "Auth server unavailable" } },
      { status: 503 },
    );
  }
}
