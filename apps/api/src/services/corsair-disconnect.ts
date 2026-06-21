import { logger } from "@repo/logger";

import { getCorsair, getCorsairPool, isCorsairConfigured } from "../corsair";

export type CorsairConnectionProvider = "gmail" | "googlecalendar";

const INTEGRATION_NAME_CANDIDATES: Record<CorsairConnectionProvider, string[]> = {
  gmail: ["gmail", "@corsair-dev/gmail"],
  googlecalendar: ["googlecalendar", "@corsair-dev/googlecalendar", "google-calendar"],
};

/**
 * Disconnect a Corsair integration for a tenant.
 * Tries the official manage.connections.delete API first, then falls back to
 * removing account rows from Postgres when tokens are expired/revoked or the API is unavailable.
 */
export async function disconnectCorsairConnection(
  tenantId: string,
  provider: CorsairConnectionProvider,
): Promise<void> {
  if (!isCorsairConfigured()) {
    throw new Error("Corsair is not configured on the server");
  }

  let apiError: unknown;
  try {
    const corsair = getCorsair();
    const deleteFn = (corsair.manage as {
      connections?: { delete: (opts: { tenantId: string; provider: string }) => Promise<void> };
    }).connections?.delete;

    if (deleteFn) {
      await deleteFn.call(corsair.manage.connections, { tenantId, provider });
      return;
    }
    apiError = new Error("Corsair connections API is not available");
  } catch (error) {
    apiError = error;
  }

  logger.warn("Corsair connections.delete failed — using DB fallback", {
    tenantId,
    provider,
    message: apiError instanceof Error ? apiError.message : String(apiError),
  });

  const removed = await deleteCorsairAccountFromDb(tenantId, provider);
  if (!removed) {
    logger.info("Corsair disconnect: no account row found (already disconnected)", {
      tenantId,
      provider,
    });
  }
}

async function deleteCorsairAccountFromDb(
  tenantId: string,
  provider: CorsairConnectionProvider,
): Promise<boolean> {
  const pool = getCorsairPool();
  const names = INTEGRATION_NAME_CANDIDATES[provider];

  const integration = await pool.query<{ id: string }>(
    `SELECT id FROM corsair_integrations WHERE name = ANY($1::text[]) LIMIT 1`,
    [names],
  );
  const integrationId = integration.rows[0]?.id;
  if (!integrationId) return false;

  const accounts = await pool.query<{ id: string }>(
    `SELECT id FROM corsair_accounts WHERE tenant_id = $1 AND integration_id = $2`,
    [tenantId, integrationId],
  );
  const accountIds = accounts.rows.map((row) => row.id);
  if (accountIds.length === 0) return false;

  await pool.query(`DELETE FROM corsair_entities WHERE account_id = ANY($1::text[])`, [accountIds]);
  await pool.query(`DELETE FROM corsair_events WHERE account_id = ANY($1::text[])`, [accountIds]);
  await pool.query(`DELETE FROM corsair_accounts WHERE id = ANY($1::text[])`, [accountIds]);
  return true;
}
