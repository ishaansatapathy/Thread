import { executePermission } from "corsair";
import { logger } from "@repo/logger";

import { getCorsair, getCorsairPool, isCorsairConfigured } from "../corsair";

/** Extract Corsair permission token from async approval error text. */
export function extractCorsairApprovalToken(message: string): string | null {
  const match = message.match(/\/corsair\/approve\/([a-f0-9]+)/i);
  return match?.[1] ?? null;
}

export function isCorsairApprovalRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Action requires approval") && Boolean(extractCorsairApprovalToken(message));
}

/**
 * Thread Queue is already human-in-the-loop. When Corsair cautious mode blocks
 * destructive calls with a permission token, execute that permission here instead
 * of making the user visit /corsair/approve and click again.
 */
export async function executeQueuedCorsairApproval(error: unknown, userId: string): Promise<boolean> {
  if (!isCorsairConfigured() || !isCorsairApprovalRequiredError(error)) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  const token = extractCorsairApprovalToken(message);
  if (!token) return false;

  try {
    const corsair = getCorsair();
    const record = await corsair.permissions.find_by_token(token);
    if (!record) return false;
    if (record.tenant_id && record.tenant_id !== userId && record.tenant_id !== "default") {
      return false;
    }

    if (record.status === "pending") {
      await getCorsairPool().query(
        `UPDATE corsair_permissions SET status = $1, updated_at = NOW() WHERE token = $2 AND status = 'pending'`,
        ["approved", token],
      );
      await executePermission(corsair, token);
    } else if (record.status !== "approved" && record.status !== "completed") {
      return false;
    }

    logger.info("corsair.queue_bridge.executed", {
      userId,
      token,
      endpoint: record.endpoint,
      plugin: record.plugin,
    });
    return true;
  } catch (bridgeError) {
    logger.warn("corsair.queue_bridge.failed", {
      userId,
      token,
      message: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
    });
    return false;
  }
}
