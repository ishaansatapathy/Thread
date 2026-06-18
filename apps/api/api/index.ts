/**
 * Vercel serverless entry — lazy bootstrap via bundled dist, clear 503 when env is missing.
 */
import type { Express } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";

let app: Express | null = null;
let bootPromise: Promise<Express> | null = null;
let bootError: { message: string; missing?: string[] } | null = null;

async function bootExpress(): Promise<Express> {
  const { validateApiEnv, runApiBootstrap } = await import("../dist/api-bootstrap.js");
  const missing = validateApiEnv();
  if (missing.length > 0) {
    const error = new Error(`Missing required environment variables: ${missing.join(", ")}`) as Error & {
      missing?: string[];
    };
    error.missing = missing;
    throw error;
  }

  await runApiBootstrap({ serverless: true });
  const { default: expressApp } = await import("../dist/server.js");
  return expressApp;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (bootError) {
    sendJson(res, 503, {
      ok: false,
      error: bootError.message,
      missing: bootError.missing,
      hint: "Set DATABASE_URL, JWT_SECRET, CORSAIR_KEK, BASE_URL, CLIENT_URL on Vercel",
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
