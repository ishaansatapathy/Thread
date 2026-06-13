import { type NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export const maxDuration = 60;

const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 90_000;
const MUTATION_TIMEOUT_MS = 120_000;

function buildUpstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const origin = request.headers.get("origin");
  if (origin) headers.set("origin", origin);
  const referer = request.headers.get("referer");
  if (referer) headers.set("referer", referer);
  if (cookie && request.method !== "GET" && request.method !== "HEAD") {
    headers.set("x-thread-csrf", "1");
  }
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  // Request identity encoding — avoids length/header mismatches when re-proxied through Vercel.
  // break browsers with ERR_CONTENT_DECODING_FAILED when re-proxied through Vercel.
  headers.set("accept-encoding", "identity");
  return headers;
}

/** Proxy tRPC so auth Set-Cookie headers reach the browser (rewrites drop them). */
async function proxyTrpc(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const pathname = path.join("/");
  const upstream = `${API_BASE}/trpc/${pathname}${request.nextUrl.search}`;
  const headers = buildUpstreamHeaders(request);

  const body =
    request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined;

  const isMutation = request.method !== "GET" && request.method !== "HEAD";
  const maxAttempts = isMutation ? 1 : ATTEMPTS;
  const timeoutMs = isMutation ? MUTATION_TIMEOUT_MS : ATTEMPT_TIMEOUT_MS;

  let upstreamRes: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      upstreamRes = await fetch(upstream, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (upstreamRes.status < 500) break;

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    } catch {
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }
      return NextResponse.json(
        {
          error: {
            message: "API is waking up — please try again in a few seconds.",
            code: -32004,
            data: { code: "TIMEOUT" },
          },
        },
        { status: 503 },
      );
    }
  }

  if (!upstreamRes) {
    return NextResponse.json(
      {
        error: {
          message: "API is waking up — please try again in a few seconds.",
          code: -32004,
          data: { code: "TIMEOUT" },
        },
      },
      { status: 503 },
    );
  }

  const bodyText = await upstreamRes.text();
  const contentType = upstreamRes.headers.get("content-type") ?? "application/json";

  let response: NextResponse;
  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(bodyText) as unknown;
      response = NextResponse.json(json, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
      });
    } catch {
      response = new NextResponse(bodyText, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: { "content-type": contentType },
      });
    }
  } else {
    response = new NextResponse(bodyText, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: { "content-type": contentType },
    });
  }

  // Prevent Vercel/CDN from gzip-transforming a plain body (ERR_CONTENT_DECODING_FAILED).
  response.headers.set("Cache-Control", "no-store, no-transform");
  response.headers.delete("content-encoding");

  appendProxiedSetCookies(response.headers, upstreamRes.headers);
  return response;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyTrpc(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyTrpc(request, context);
}
