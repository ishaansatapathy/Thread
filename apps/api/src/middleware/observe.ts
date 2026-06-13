import type { Request, Response, NextFunction } from "express";
import { recordRequest } from "../metrics";

/**
 * Express middleware that records per-route latency + status into the
 * in-process metrics store.  Attaches to every route automatically.
 *
 * Route normalisation:
 *  /trpc/inbox.listThreads?... → trpc/inbox.listThreads
 *  /api/inbox/threads          → api/inbox/threads
 *  /health, /ready, /docs      → kept as-is
 */
function normalisePath(req: Request): string {
  const raw = req.path.replace(/^\//, "");

  // tRPC paths: strip query string (already done by req.path) + extract procedure
  if (raw.startsWith("trpc/")) {
    return raw.split("?")[0]!;
  }
  // OpenAPI REST paths
  if (raw.startsWith("api/")) {
    return raw.split("?")[0]!;
  }
  return raw.split("?")[0]!;
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    recordRequest(normalisePath(req), res.statusCode, duration);
  });

  next();
}
