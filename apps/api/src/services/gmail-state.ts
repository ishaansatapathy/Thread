import { eq } from "@repo/database";
import db from "@repo/database";
import { threadGmailStateTable } from "@repo/database/schema";
import { logger } from "@repo/logger";

/** Write-through cache — avoids a DB round-trip on every webhook POST. */
const lastHistoryIdByUser = new Map<string, string>();

export async function setLastHistoryId(userId: string, historyId: string) {
  lastHistoryIdByUser.set(userId, historyId);
  try {
    await db
      .insert(threadGmailStateTable)
      .values({ userId, historyId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: threadGmailStateTable.userId,
        set: { historyId, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn("Failed to persist historyId to DB", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getLastHistoryId(userId: string): Promise<string | undefined> {
  const cached = lastHistoryIdByUser.get(userId);
  if (cached) return cached;
  try {
    const [row] = await db
      .select({ historyId: threadGmailStateTable.historyId })
      .from(threadGmailStateTable)
      .where(eq(threadGmailStateTable.userId, userId))
      .limit(1);
    if (row?.historyId) {
      lastHistoryIdByUser.set(userId, row.historyId);
      return row.historyId;
    }
  } catch {
    // best-effort
  }
  return undefined;
}
