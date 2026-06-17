/**
 * Renews Gmail Pub/Sub watches (~7 day expiry) and Google Calendar push channels.
 * Runs daily in production; skipped in test.
 */

import { logger } from "@repo/logger";
import { acquireLeaderLock } from "@repo/services/cache/leader-lock";
import db from "@repo/database";
import { usersTable } from "@repo/database/schema";

import { env } from "../env";
import { isCorsairConfigured } from "../corsair";
import { CorsairInboxService } from "../services/inbox";
import { CorsairCalendarService } from "../services/calendar";

const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 60_000;
const LEADER_LOCK_TTL_MS = 26 * 60 * 60 * 1000;
const LEADER_LOCK_NAME = "integration-renewal";

/**
 * List all known tenant IDs from our own users table (Drizzle ORM + Postgres).
 * Each user's `id` is the Corsair tenantId for that account.
 * This replaces the previous raw SQL query against Corsair's internal DB table.
 */
async function listConnectedTenantIds(): Promise<string[]> {
  try {
    const rows = await db.select({ id: usersTable.id }).from(usersTable);
    return rows.map((r) => r.id).filter(Boolean);
  } catch (error) {
    logger.warn("integration-renewal: could not list tenant ids from users table", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function renewIntegrationsForAllTenants() {
  if (!isCorsairConfigured()) return;

  const inbox = new CorsairInboxService();
  const calendar = new CorsairCalendarService();
  const webhooksBaseUrl = process.env.WEBHOOKS_BASE_URL?.trim() || env.BASE_URL;
  const tenantIds = await listConnectedTenantIds();

  if (tenantIds.length === 0) {
    logger.debug("integration-renewal: no corsair tenants to renew");
    return;
  }

  logger.info("integration-renewal: starting", { tenants: tenantIds.length });

  for (const tenantId of tenantIds) {
    try {
      const gmailStatus = await inbox.getConnectionStatus(tenantId);
      if (gmailStatus.gmail === "connected") {
        await inbox.registerGmailWatch(tenantId);
      }
    } catch (error) {
      logger.warn("integration-renewal: Gmail watch failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const calStatus = await calendar.getConnectionStatus(tenantId);
      if (calStatus.googlecalendar === "connected") {
        await calendar.registerWebhook(tenantId, `${webhooksBaseUrl}/webhooks/calendar`);
      }
    } catch (error) {
      logger.warn("integration-renewal: Calendar channel failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("integration-renewal: complete", { tenants: tenantIds.length });
}

export function startIntegrationRenewalJob() {
  if (process.env.VITEST === "true") return;
  if (process.env.DISABLE_INTEGRATION_RENEWAL === "true") return;

  const tick = () => {
    void (async () => {
      const isLeader = await acquireLeaderLock(LEADER_LOCK_NAME, LEADER_LOCK_TTL_MS);
      if (!isLeader) {
        logger.debug("integration-renewal: skipped (another replica holds the lock)");
        return;
      }

      await renewIntegrationsForAllTenants();
    })().catch((error: unknown) => {
      logger.warn("integration-renewal: job error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };

  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, RENEWAL_INTERVAL_MS);
  logger.info("integration-renewal: scheduled daily");
}
