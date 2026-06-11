import http from "node:http";

const PORT = Number(process.env.PORT ?? 8000);

function writeJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function bootstrap() {
  let expressHandler: http.RequestListener | null = null;

  const server = http.createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";

    if (path === "/health" || path === "/") {
      writeJson(res, 200, {
        healthy: true,
        ready: Boolean(expressHandler),
        message: expressHandler ? "Thread API is healthy" : "Thread API is starting",
      });
      return;
    }

    if (!expressHandler) {
      writeJson(res, 503, {
        error: "Thread API is starting",
        hint: "Wait a few seconds, or check Postgres is running (pnpm db:up) and DATABASE_URL in .env",
      });
      return;
    }

    expressHandler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "0.0.0.0", () => resolve());
  });

  const { logger } = await import("@repo/logger");
  logger.info(`http server is running on 0.0.0.0:${PORT}`);

  try {
    const { runMigrations } = await import("./migrate");
    await runMigrations();
    logger.info("Database schema patches applied");
  } catch (err) {
    logger.error("Database migration failed", { err });
    const nodeEnv = process.env.NODE_ENV ?? "development";
    if (["production", "prod"].includes(nodeEnv)) {
      process.exit(1);
    }
  }

  try {
    const { registerInboxService } = await import("@repo/services/inbox");
    const { CorsairInboxService } = await import("./services/inbox");
    registerInboxService(new CorsairInboxService());
  } catch (err) {
    logger.warn("Inbox service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { registerCalendarService } = await import("@repo/services/calendar");
    const { CorsairCalendarService } = await import("./services/calendar");
    registerCalendarService(new CorsairCalendarService());
  } catch (err) {
    logger.warn("Calendar service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { bootstrapCorsair } = await import("./corsair-bootstrap");
    await bootstrapCorsair();
  } catch (err) {
    logger.warn("Corsair bootstrap skipped", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { app } = await import("./server");
    expressHandler = app;
    logger.info("Express application loaded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load Express application", { err, message });
    return;
  }

  const { isEmailConfigured } = await import("@repo/services/env");
  logger.info(
    isEmailConfigured()
      ? "Email: provider configured — transactional mail enabled for all users"
      : "Email: not configured — links will only appear in API logs (set BREVO_API_KEY + EMAIL_FROM on Railway)",
  );
}

bootstrap().catch((err) => {
  console.error("Fatal bootstrap error", err);
  process.exit(1);
});
