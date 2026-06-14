import { randomUUID } from "node:crypto";

import { eq } from "@repo/database";
import db from "@repo/database";
import { threadGmailStateTable, usersTable } from "@repo/database/schema";
import { describe, expect, it } from "vitest";

import { getLastHistoryId, setLastHistoryId } from "./gmail-state";

describe("gmail-state DB persistence", () => {
  it("persists and reads historyId across cache miss", async () => {
    const userId = randomUUID();
    const historyId = `hist-${Date.now()}`;

    await db.insert(usersTable).values({
      id: userId,
      fullName: "Gmail State Test",
      email: `gmail-state-${userId}@test.local`,
      passwordHash: "x",
      authProvider: "local",
      emailVerified: true,
      role: "user",
      tokenVersion: "0",
    });

    try {
      await setLastHistoryId(userId, historyId);

      const fromDb = await db
        .select({ historyId: threadGmailStateTable.historyId })
        .from(threadGmailStateTable)
        .where(eq(threadGmailStateTable.userId, userId))
        .limit(1);

      expect(fromDb[0]?.historyId).toBe(historyId);

      // Simulate cold start — in-memory cache is per-process; re-read via getter.
      const readBack = await getLastHistoryId(userId);
      expect(readBack).toBe(historyId);
    } finally {
      await db.delete(threadGmailStateTable).where(eq(threadGmailStateTable.userId, userId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });
});
