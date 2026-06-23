import { type NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";
import { sanitizeRedirectPath } from "@repo/services/auth/safe-redirect";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

function demoErrorRedirect(request: NextRequest, message: string) {
  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("error", message);
  return NextResponse.redirect(signInUrl);
}

export async function GET(request: NextRequest) {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    return demoErrorRedirect(request, "Demo login is not enabled.");
  }

  const nextPath = sanitizeRedirectPath(request.nextUrl.searchParams.get("next"));

  try {
    const upstreamRes = await fetch(`${API_BASE}/api/authentication/demo-sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstreamRes.ok) {
      if (upstreamRes.status >= 500) {
        return demoErrorRedirect(
          request,
          "Demo login unavailable — API error. Check thread-web API_INTERNAL_URL points to thread-api-smoky.",
        );
      }
      if (upstreamRes.status === 403) {
        return demoErrorRedirect(
          request,
          "Demo login disabled on API. Set DEMO_LOGIN_ENABLED=true on thread-api-smoky and redeploy.",
        );
      }
      return demoErrorRedirect(
        request,
        "Demo login failed. Run pnpm db:seed against production DATABASE_URL, then try again.",
      );
    }

    const dashboardUrl = new URL(nextPath, request.url);
    const response = NextResponse.redirect(dashboardUrl);
    appendProxiedSetCookies(response.headers, upstreamRes.headers);
    return response;
  } catch {
    return demoErrorRedirect(
      request,
      "Demo login unavailable — cannot reach API. Check API_INTERNAL_URL on thread-web.",
    );
  }
}
