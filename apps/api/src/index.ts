// OpenTelemetry MUST be imported first — before any instrumented modules.
import { initTracing } from "./tracing";
initTracing();

import http from "node:http";

import { runApiBootstrap } from "./api-bootstrap";

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

  await runApiBootstrap({ serverless: false });

  try {
    const { app } = await import("./server");
    expressHandler = app;
    logger.info("Express application loaded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load Express application", { err, message });
    return;
  }
}

bootstrap().catch((err) => {
  console.error("Fatal bootstrap error", err);
  process.exit(1);
});
