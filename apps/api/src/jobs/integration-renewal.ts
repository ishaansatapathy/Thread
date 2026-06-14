/**
 * Renews Gmail Pub/Sub watches (~7 day expiry) and Google Calendar push channels.
 * Runs daily in production; skipped in test.
 */

import { logger } from "@repo/logger";

import { env } from "../env";
import { getCorsairPool, isCorsairConfigured } from "../corsair";
import { CorsairInboxService } from "../services/inbox";
import { CorsairCalendarService } from "../services/calendar";

const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 60_000;

async function listConnectedTenantIds(): Promise<string[]> {
  try {
    const pool = getCorsairPool();
    const result = await pool.query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM corsair_accounts WHERE tenant_id IS NOT NULL AND tenant_id <> ''`,
    );
    return result.rows.map((row) => row.tenant_id).filter(Boolean);
  } catch (error) {
    logger.warn("integration-renewal: could not list corsair tenants", {
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
    void renewIntegrationsForAllTenants().catch((error: unknown) => {
      logger.warn("integration-renewal: job error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };

  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, RENEWAL_INTERVAL_MS);
  logger.info("integration-renewal: scheduled daily");
}
