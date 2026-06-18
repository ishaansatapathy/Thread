import { logger } from "@repo/logger";

import { getCorsair, isCorsairConfigured } from "../corsair";
import { getCorsairSetupModule } from "../corsair-imports";
import { ensureCorsairTenant } from "./corsair-tenant";

/**
 * Seed corsair_entities via setupCorsair backfill (list endpoints from backfill.yaml).
 * Runs after OAuth when the tenant has valid tokens — idempotent.
 */
export async function backfillCorsairTenant(tenantId: string): Promise<void> {
  if (!isCorsairConfigured()) return;

  try {
    await ensureCorsairTenant(tenantId);
    const corsair = getCorsair();
    const { setupCorsair } = getCorsairSetupModule();
    const output = await setupCorsair(corsair, {
      tenantId,
      backfill: true,
      caller: "script",
    });

    if (output.trim()) {
      logger.info("Corsair tenant backfill completed", {
        tenantId,
        output: output.trim().slice(0, 500),
      });
    }
  } catch (error) {
    logger.warn("Corsair tenant backfill failed (non-fatal)", {
      tenantId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
