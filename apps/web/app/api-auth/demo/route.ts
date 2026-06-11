import { type NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";
import { sanitizeRedirectPath } from "@repo/services/auth/safe-redirect";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function GET(request: NextRequest) {
  const signInUrl = new URL("/sign-in", request.url);

  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    signInUrl.searchParams.set("error", "Demo login is not enabled.");
    return NextResponse.redirect(signInUrl);
  }

  const email = process.env.DEMO_USER_EMAIL ?? process.env.SEED_USER_EMAIL ?? "demo@thread.dev";
  const password = process.env.DEMO_USER_PASSWORD ?? process.env.SEED_DEMO_PASSWORD ?? "DemoPass123!";
  const nextPath = sanitizeRedirectPath(request.nextUrl.searchParams.get("next"));

  try {
    const upstreamRes = await fetch(`${API_BASE}/api/authentication/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      redirect: "manual",
      cache: "no-store",
    });

    if (!upstreamRes.ok) {
      signInUrl.searchParams.set("error", "Demo login failed. Run the production seed and try again.");
      return NextResponse.redirect(signInUrl);
    }

    const dashboardUrl = new URL(nextPath, request.url);
    const response = NextResponse.redirect(dashboardUrl);
    appendProxiedSetCookies(response.headers, upstreamRes.headers);
    return response;
  } catch {
    signInUrl.searchParams.set("error", "Demo login is unavailable right now.");
    return NextResponse.redirect(signInUrl);
  }
}
