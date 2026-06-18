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
import { metricsMiddleware } from "./middleware/observe";
import { snapshot, snapshotMerged, toPrometheusText, incrementCounter } from "./metrics";

import { googleAuthRouter } from "./routes/google-auth";
import { corsairAuthRouter } from "./routes/corsair-auth";
import { webhooksRouter } from "./routes/webhooks";
import { mcpRouter } from "./routes/mcp";
import { corsairMcpGate, corsairOfficialMcpRouter } from "./routes/corsair-mcp";
import { corsairManagementRouter } from "./routes/corsair-management";
import { corsairPermissionsRouter } from "./routes/corsair-permissions";
import { agentStreamRouter } from "./routes/agent-stream";
import { syncEventsRouter } from "./routes/sync-events";
import { attachmentsRouter } from "./routes/attachments";
import { enrichThreadOpenApi, type OpenApiDocumentWithPaths } from "./openapi-enrichment";

export const app = express();

app.set("trust proxy", 1);

app.use(metricsMiddleware);

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
      version: "2.5.0",
      baseUrl: env.BASE_URL.concat("/api"),
    });

    return enrichThreadOpenApi(document as OpenApiDocumentWithPaths, {
      clientUrl: env.CLIENT_URL,
      baseUrl: env.BASE_URL,
    });
  } catch (error) {
    logger.error("OpenAPI document generation failed", {
      message: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

let cachedOpenApiDocument: OpenApiDocumentWithPaths | null = null;

function getOpenApiDocument(): OpenApiDocumentWithPaths {
  if (!cachedOpenApiDocument) {
    cachedOpenApiDocument = buildOpenApiDocument();
  }
  return cachedOpenApiDocument;
}

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

  try {
    const { isCorsairDevKeyConfigured } = await import("./corsair");
    checks.corsairDevKey = {
      ok: true,
      message: isCorsairDevKeyConfigured()
        ? "CORSAIR_DEV_KEY configured (Corsair CLI / dashboard)"
        : "CORSAIR_DEV_KEY not set (optional — set for Corsair dashboard API / setup)",
    };
  } catch {
    checks.corsairDevKey = { ok: true, message: "CORSAIR_DEV_KEY check skipped" };
  }

  const gmailTopic = process.env.CORSAIR_GMAIL_TOPIC_ID?.trim();
  checks.gmailWatch = gmailTopic
    ? { ok: true, message: "Gmail Pub/Sub topic configured for users.watch" }
    : {
        ok: true,
        message: "CORSAIR_GMAIL_TOPIC_ID not set (optional — Gmail push watches disabled until set)",
      };

  const webhookSecret = env.CORSAIR_WEBHOOK_SECRET?.trim();
  checks.webhooks = webhookSecret
    ? { ok: true, message: "Webhook secret configured" }
    : {
        ok: true,
        message: "CORSAIR_WEBHOOK_SECRET not set (optional — webhook endpoints return 503 until set)",
      };

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
  return res.json({
    message: "Thread API is up and running...",
    mcp: `${env.BASE_URL}/mcp`,
    corsairMcp: `${env.BASE_URL}/mcp/corsair`,
    corsairManagement: `${env.BASE_URL}/api/corsair`,
    docs: `${env.BASE_URL}/docs`,
    health: `${env.BASE_URL}/health`,
  });
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

/** Prometheus-compatible plaintext metrics. */
app.get("/metrics", requireOpenApiDocsAuth, (_req, res) => {
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return res.send(toPrometheusText());
});

/** JSON metrics for dashboards / health pages. */
app.get("/metrics/json", requireOpenApiDocsAuth, async (_req, res) => {
  const merged = await snapshotMerged();
  return res.json({ ok: true, timestamp: new Date().toISOString(), ...merged });
});

export { incrementCounter };

logger.debug(`openapi.json: ${env.BASE_URL}/openapi.json`);

app.get("/openapi.json", requireOpenApiDocsAuth, (_req, res) => {
  try {
    return res.json(getOpenApiDocument());
  } catch (error) {
    logger.error("OpenAPI document unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({
      error: "OpenAPI document unavailable",
      hint: "Check server logs for generation errors",
    });
  }
});

logger.debug(`docs: ${env.BASE_URL}/docs`);

import("@scalar/express-api-reference")
  .then(({ apiReference }) => {
    app.use(
      "/docs",
      requireOpenApiDocsAuth,
      apiReference({
        url: "/openapi.json",
        theme: "purple",
        layout: "modern",
        metaData: {
          title: "Thread API Reference",
          description:
            "Corsair-powered Gmail & Calendar — REST, MCP (57 tools), webhooks, approval queue. Built for the Corsair Hackathon.",
        },
        authentication: {
          preferredSecurityScheme: "cookieAuth",
        },
        persistAuth: true,
        defaultHttpClient: {
          targetKey: "node",
          clientKey: "fetch",
        },
      }),
    );
  })
  .catch((error) => {
    logger.warn("API docs disabled", {
      message: error instanceof Error ? error.message : error,
    });
  });

app.use("/auth", googleAuthRouter);
app.use("/auth/corsair", corsairAuthRouter);
app.use("/webhooks", webhooksRouter);
app.use("/mcp/corsair", corsairMcpGate, corsairOfficialMcpRouter);
app.use("/mcp", mcpRouter);
app.use("/corsair/permissions", corsairPermissionsRouter);
app.use("/api/corsair", corsairManagementRouter);
app.use("/agent/stream", agentStreamRouter);
app.use("/sync/events", syncEventsRouter);
app.use("/inbox/attachments", attachmentsRouter);

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

// Global error handler — catch unhandled errors outside tRPC.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error("Unhandled Express error", {
    path: req.path,
    message: err.message,
  });
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});
