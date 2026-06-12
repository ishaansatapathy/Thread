import express from "express";

import { logger } from "@repo/logger";

import cors from "cors";

import cookieParser from "cookie-parser";

import helmet from "helmet";

import type { Request, Response, NextFunction } from "express";

import * as trpcExpress from "@trpc/server/adapters/express";

import { generateOpenApiDocument, createOpenApiExpressMiddleware } from "trpc-to-openapi";

import { serverRouter, openApiRouter, createContext } from "@repo/trpc/server";

import { env } from "./env";

import { createTrpcRateLimitMiddleware } from "./middleware/rate-limiters";

import { googleAuthRouter } from "./routes/google-auth";
import { corsairAuthRouter } from "./routes/corsair-auth";
import { webhooksRouter } from "./routes/webhooks";

export const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

function normalizeOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

function trustedOrigins() {
  return new Set(
    [env.CLIENT_URL, env.BASE_URL, "http://localhost:3000", "http://localhost:8000"]
      .map((value) => normalizeOrigin(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();

  const hasCookieAuth = Boolean(req.headers.cookie);
  const origin = normalizeOrigin(req.headers.origin);
  const referer = normalizeOrigin(req.headers.referer);
  const observed = origin ?? referer;

  if (observed && !trustedOrigins().has(observed)) {
    return res.status(403).json({ error: "Untrusted request origin" });
  }

  if (!observed && hasCookieAuth) {
    return res.status(403).json({ error: "Missing request origin" });
  }

  if (hasCookieAuth && req.headers["x-thread-csrf"] !== "1") {
    return res.status(403).json({ error: "Missing CSRF header" });
  }

  return next();
}

function buildOpenApiDocument() {
  try {
    const document = generateOpenApiDocument(openApiRouter, {
      title: "Thread API",
      version: "0.1.0",
      baseUrl: env.BASE_URL.concat("/api"),
    });

    document.info = {
      ...document.info,
      description: "Thread REST API generated from tRPC. Domain routes will be added as features ship.",
    };

    document.servers = [{ url: env.BASE_URL.concat("/api"), description: "Thread API" }];

    return document;
  } catch (error) {
    logger.error("OpenAPI document generation failed", {
      message: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

const openApiDocument = buildOpenApiDocument();

function isProduction() {
  return env.NODE_ENV === "production" || env.NODE_ENV === "prod";
}

async function getReadinessReport() {
  const checks: Record<string, { ok: boolean; message: string }> = {};

  try {
    const { pingDatabase } = await import("@repo/database/health");
    await pingDatabase();
    checks.database = { ok: true, message: "Database reachable" };
  } catch (error) {
    checks.database = {
      ok: false,
      message: `Database unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    const { isGoogleOAuthConfigured } = await import("@repo/services/env");
    checks.googleOAuth = {
      ok: isGoogleOAuthConfigured(),
      message: isGoogleOAuthConfigured()
        ? "Google OAuth configured"
        : "Google OAuth not configured (client id/secret/redirect missing)",
    };
  } catch (error) {
    checks.googleOAuth = {
      ok: false,
      message: `Unable to inspect OAuth config: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const requiredCoreEnvs = [
    "DATABASE_URL",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "CLIENT_URL",
    "BASE_URL",
  ] as const;
  const missingCoreEnvs = requiredCoreEnvs.filter((key) => !process.env[key]?.trim());
  checks.coreEnv = missingCoreEnvs.length
    ? { ok: false, message: `Missing core env vars: ${missingCoreEnvs.join(", ")}` }
    : { ok: true, message: "Core env vars present" };

  const ready = Object.values(checks).every((check) => check.ok);
  return { ready, checks };
}

function requireOpenApiDocsAuth(req: Request, res: Response, next: NextFunction) {
  if (!isProduction()) return next();

  if (env.PUBLIC_OPENAPI_DOCS !== "false") return next();

  const secret = env.OPENAPI_DOCS_SECRET;
  if (!secret) {
    return res.status(404).json({ error: "Not found" });
  }

  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const queryKey = typeof req.query.key === "string" ? req.query.key : undefined;
  if (bearer !== secret && queryKey !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  }),
);

app.use(requireTrustedOrigin);
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));

app.get("/", (_req, res) => {
  return res.json({ message: "Thread API is up and running..." });
});

app.get("/health", async (_req, res) => {
  const checkDatabase = process.env.HEALTH_CHECK_DATABASE !== "false";
  try {
    if (checkDatabase) {
      const { pingDatabase } = await import("@repo/database/health");
      await pingDatabase();
    }
    return res.json({
      message: "Thread API is healthy",
      healthy: true,
      ...(checkDatabase ? { database: "ok" as const } : {}),
    });
  } catch (error) {
    logger.error("Health check failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({
      message: "Thread API is unhealthy",
      healthy: false,
      database: "error",
    });
  }
});

app.get("/ready", async (_req, res) => {
  const report = await getReadinessReport();
  return res.status(report.ready ? 200 : 503).json(report);
});

logger.debug(`openapi.json: ${env.BASE_URL}/openapi.json`);

app.get("/openapi.json", requireOpenApiDocsAuth, (_req, res) => {
  return res.json(openApiDocument);
});

logger.debug(`docs: ${env.BASE_URL}/docs`);

import("@scalar/express-api-reference")
  .then(({ apiReference }) => {
    app.use("/docs", requireOpenApiDocsAuth, apiReference({ url: "/openapi.json" }));
  })
  .catch((error) => {
    logger.warn("API docs disabled", {
      message: error instanceof Error ? error.message : error,
    });
  });

app.use("/auth", googleAuthRouter);
app.use("/auth/corsair", corsairAuthRouter);
app.use("/webhooks", webhooksRouter);

const trpcRateLimit = createTrpcRateLimitMiddleware();

try {
  app.use(
    "/api",
    trpcRateLimit,
    createOpenApiExpressMiddleware({
      router: serverRouter,
      createContext,
    }),
  );
} catch (error) {
  logger.warn("OpenAPI REST middleware disabled", {
    message: error instanceof Error ? error.message : error,
  });
}

app.use(
  "/trpc",
  trpcRateLimit,
  trpcExpress.createExpressMiddleware({
    router: serverRouter,
    createContext,
  }),
);

export default app;
