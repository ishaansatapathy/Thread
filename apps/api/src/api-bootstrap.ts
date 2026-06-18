/**
 * Shared API bootstrap — used by Railway (index.ts) and Vercel (api/index.ts).
 */
import { logger } from "@repo/logger";

export type ApiBootstrapOptions = {
  /** Skip long-running cron / Redis when running as a serverless function. */
  serverless?: boolean;
};

export async function runApiBootstrap(opts: ApiBootstrapOptions = {}): Promise<void> {
  const { serverless = false } = opts;

  try {
    const { runMigrations } = await import("./migrate");
    await runMigrations();
    logger.info("Database schema patches applied");
  } catch (err) {
    logger.error("Database migration failed", { err });
  }

  try {
    const { registerInboxService } = await import("@repo/services/inbox");
    const { CorsairInboxService } = await import("./services/inbox");
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
    const { registerCalendarService } = await import("@repo/services/calendar");
    const { CorsairCalendarService } = await import("./services/calendar");
    registerCalendarService(new CorsairCalendarService());
  } catch (err) {
    logger.warn("Calendar service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { registerQueueService } = await import("@repo/services/queue");
    const { ThreadQueueService } = await import("./services/queue");
    registerQueueService(new ThreadQueueService());
  } catch (err) {
    logger.warn("Queue service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { registerContactsService } = await import("@repo/services/contacts");
    const { DbContactsService } = await import("./services/contacts");
    registerContactsService(new DbContactsService());
  } catch (err) {
    logger.warn("Contacts service registration failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { registerSettingsService } = await import("@repo/services/settings");
    const { DbSettingsService } = await import("./services/settings");
    registerSettingsService(new DbSettingsService());
  } catch (err) {
    logger.warn("Settings service registration failed", {
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

  const { isEmailConfigured } = await import("@repo/services/env");
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
