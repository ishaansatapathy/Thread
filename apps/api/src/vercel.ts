/**
 * Bundled Vercel serverless handler — imported by api/index.js after `pnpm build`.
 */
import type { Express } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";

import expressApp from "./server";
import { runApiBootstrap, validateApiEnv } from "./api-bootstrap";

let app: Express | null = null;
let bootPromise: Promise<Express> | null = null;
let bootError: { message: string; missing?: string[] } | null = null;

async function bootExpress(): Promise<Express> {
  const missing = validateApiEnv();
  if (missing.length > 0) {
    const error = new Error(`Missing required environment variables: ${missing.join(", ")}`) as Error & {
      missing?: string[];
    };
    error.missing = missing;
    throw error;
  }

  await runApiBootstrap({ serverless: true });
  return expressApp;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  const path = req.url?.split("?")[0] ?? "/";

  if (bootError) {
    sendJson(res, 503, {
      ok: false,
      error: bootError.message,
      missing: bootError.missing,
      hint: "Set DATABASE_URL, JWT_SECRET, CORSAIR_KEK, BASE_URL, CLIENT_URL on Vercel (see apps/api/VERCEL_DEPLOY.md)",
    });
    return;
  }

  try {
    if (!bootPromise) {
      bootPromise = bootExpress().catch((err: Error & { missing?: string[] }) => {
        bootError = { message: err.message, missing: err.missing };
        throw err;
      });
    }

    if (!app && (path === "/health" || path === "/")) {
      sendJson(res, 200, {
        healthy: true,
        ready: false,
        message: "Thread API is starting — wait a few seconds and retry",
      });
      void bootPromise.catch(() => undefined);
      return;
    }

    app ??= await bootPromise;
    app(req, res);
  } catch (err) {
    if (res.headersSent) return;
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 503, {
      ok: false,
      error: "Thread API failed to start",
      message,
      hint: "Check Vercel env vars and deployment logs for thread-api",
    });
  }
}

export default handler;
