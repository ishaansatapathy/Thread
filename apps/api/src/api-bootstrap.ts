/**
 * Shared API bootstrap — used by Railway (index.ts) and Vercel (api/index.ts).
 *
 * Static service imports keep the Vercel serverless bundle self-contained
 * (dynamic import() would resolve missing ./services/* at runtime).
 */
import { logger } from "@repo/logger";
import { registerCalendarService } from "@repo/services/calendar";
import { registerContactsService } from "@repo/services/contacts";
import { isEmailConfigured } from "@repo/services/env";
import { registerInboxService } from "@repo/services/inbox";
import { registerQueueService } from "@repo/services/queue";
import { registerSettingsService } from "@repo/services/settings";

import { bootstrapCorsair } from "./corsair-bootstrap";
import { runMigrations } from "./migrate";
import { CorsairCalendarService } from "./services/calendar";
import { DbContactsService } from "./services/contacts";
import { CorsairInboxService } from "./services/inbox";
import { ThreadQueueService } from "./services/queue";
import { DbSettingsService } from "./services/settings";

export type ApiBootstrapOptions = {
  /** Skip long-running cron / Redis when running as a serverless function. */
  serverless?: boolean;
};

export async function runApiBootstrap(opts: ApiBootstrapOptions = {}): Promise<void> {
  const { serverless = false } = opts;

  try {
    await runMigrations();
    logger.info("Database schema patches applied");
  } catch (err) {
    logger.error("Database migration failed", { err });
  }

  try {
    const inbox = new CorsairInboxService();
    if (process.env.THREAD_E2E_MOCK_GMAIL === "true") {
      const { createE2eMockInboxService } = await import("./services/inbox-e2e-mock");
      registerInboxService(createE2eMockInboxService(inbox));
      logger.info("Inbox: E2E mock Gmail enabled");
    } else {
      registerInboxService(inbox);
    }
  } catch (err) {
    logger.warn("Inbox service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    registerCalendarService(new CorsairCalendarService());
  } catch (err) {
    logger.warn("Calendar service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    registerQueueService(new ThreadQueueService());
  } catch (err) {
    logger.warn("Queue service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    registerContactsService(new DbContactsService());
  } catch (err) {
    logger.warn("Contacts service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    registerSettingsService(new DbSettingsService());
  } catch (err) {
    logger.warn("Settings service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await bootstrapCorsair();
  } catch (err) {
    logger.warn("Corsair bootstrap skipped", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (!serverless) {
    try {
      const { startIntegrationRenewalJob } = await import("./jobs/integration-renewal");
      startIntegrationRenewalJob();
    } catch (err) {
      logger.warn("Integration renewal job skipped", {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const { startSyncEventRedisBridge } = await import("./services/sync-events");
      await startSyncEventRedisBridge();
    } catch (err) {
      logger.warn("Sync event Redis bridge skipped", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(
    isEmailConfigured()
      ? "Email: provider configured"
      : "Email: not configured (set BREVO_API_KEY + EMAIL_FROM)",
  );
}

export function validateApiEnv(): string[] {
  return ["DATABASE_URL", "JWT_SECRET", "CORSAIR_KEK", "BASE_URL", "CLIENT_URL"].filter(
    (key) => !process.env[key]?.trim(),
  );
}
