import { and, desc, eq, ilike, inArray, or, sql } from "@repo/database";
import db from "@repo/database";
import { threadMailCacheTable, type SelectMailCacheRow } from "@repo/database/schema";
import { logger } from "@repo/logger";
import type { InboxThread } from "@repo/services/inbox";

export type CachedThreadMetadata = {
  threadId: string;
  historyId?: string;
  subject?: string;
  fromName?: string;
  fromAddress?: string;
  snippet?: string;
  lastMessageAt?: Date;
  messageCount?: number;
  unread?: boolean;
  labelIds?: string[];
};

function rowToThread(row: SelectMailCacheRow): InboxThread {
  return {
    id: row.threadId,
    snippet: row.snippet ?? "",
    historyId: row.historyId ?? undefined,
    subject: row.subject ?? undefined,
    from: row.fromAddress ?? undefined,
    fromName: row.fromName ?? undefined,
    date: row.lastMessageAt?.toISOString(),
    messageCount: row.messageCount,
    unread: row.unread,
  };
}

/** Stable composite key so upserts target a single row per (tenant, thread). */
function cacheId(userId: string, threadId: string) {
  return `${userId}:${threadId}`;
}

/**
 * Best-effort cache writes. Cache failures must never break the live inbox, so
 * every method swallows errors after logging.
 */
export const mailCache = {
  async upsertMany(userId: string, items: CachedThreadMetadata[]) {
    if (items.length === 0) return;
    try {
      await db
        .insert(threadMailCacheTable)
        .values(
          items.map((item) => ({
            id: cacheId(userId, item.threadId),
            userId,
            threadId: item.threadId,
            historyId: item.historyId ?? null,
            subject: item.subject ?? null,
            fromName: item.fromName ?? null,
            fromAddress: item.fromAddress ?? null,
            snippet: item.snippet ?? null,
            lastMessageAt: item.lastMessageAt ?? null,
            messageCount: item.messageCount ?? 1,
            unread: item.unread ?? false,
            labelIds: item.labelIds ?? [],
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: threadMailCacheTable.id,
          set: {
            historyId: sql`excluded.history_id`,
            subject: sql`excluded.subject`,
            fromName: sql`excluded.from_name`,
            fromAddress: sql`excluded.from_address`,
            snippet: sql`excluded.snippet`,
            lastMessageAt: sql`excluded.last_message_at`,
            messageCount: sql`excluded.message_count`,
            unread: sql`excluded.unread`,
            labelIds: sql`excluded.label_ids`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    } catch (error) {
      logger.warn("Mail cache upsert failed", {
        userId,
        count: items.length,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  /** Returns cached rows keyed by threadId for historyId short-circuit checks. */
  async getHistoryMap(userId: string, threadIds: string[]): Promise<Map<string, SelectMailCacheRow>> {
    const map = new Map<string, SelectMailCacheRow>();
    if (threadIds.length === 0) return map;
    try {
      const rows = await db
        .select()
        .from(threadMailCacheTable)
        .where(
          and(
            eq(threadMailCacheTable.userId, userId),
            inArray(threadMailCacheTable.threadId, threadIds),
          ),
        );
      for (const row of rows) {
        map.set(row.threadId, row);
      }
    } catch (error) {
      logger.warn("Mail cache read failed", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return map;
  },

  /** Local fallback search over cached metadata (used when Gmail is unreachable). */
  async search(userId: string, query: string, limit = 25): Promise<InboxThread[]> {
    const term = `%${query.trim()}%`;
    try {
      const rows = await db
        .select()
        .from(threadMailCacheTable)
        .where(
          and(
            eq(threadMailCacheTable.userId, userId),
            or(
              ilike(threadMailCacheTable.subject, term),
              ilike(threadMailCacheTable.fromAddress, term),
              ilike(threadMailCacheTable.fromName, term),
              ilike(threadMailCacheTable.snippet, term),
            ),
          ),
        )
        .orderBy(desc(threadMailCacheTable.lastMessageAt))
        .limit(limit);
      return rows.map(rowToThread);
    } catch (error) {
      logger.warn("Mail cache search failed", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  },

  async recent(userId: string, limit = 25): Promise<InboxThread[]> {
    try {
      const rows = await db
        .select()
        .from(threadMailCacheTable)
        .where(eq(threadMailCacheTable.userId, userId))
        .orderBy(desc(threadMailCacheTable.lastMessageAt))
        .limit(limit);
      return rows.map(rowToThread);
    } catch (error) {
      logger.warn("Mail cache recent failed", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  },

  /** Preserve Gmail list order when hydrating from Postgres. */
  async getOrderedThreads(userId: string, threadIds: string[]): Promise<InboxThread[]> {
    if (threadIds.length === 0) return [];
    const map = await this.getHistoryMap(userId, threadIds);
    return threadIds
      .map((threadId) => map.get(threadId))
      .filter((row): row is SelectMailCacheRow => Boolean(row))
      .map(rowToThread);
  },

  /** Returns a single cached thread as a full InboxThread (demo / offline mode). */
  async getThread(userId: string, threadId: string): Promise<InboxThread | null> {
    const map = await this.getHistoryMap(userId, [threadId]);
    const row = map.get(threadId);
    if (!row) return null;

    const body = row.snippet?.trim() ?? "";
    const fromDisplay =
      row.fromName && row.fromAddress
        ? `${row.fromName} <${row.fromAddress}>`
        : row.fromName ?? row.fromAddress ?? "Unknown";

    return {
      id: row.threadId,
      snippet: body.slice(0, 240) || row.subject?.slice(0, 240) || "",
      historyId: row.historyId ?? undefined,
      subject: row.subject ?? undefined,
      from: row.fromAddress ?? undefined,
      fromName: row.fromName ?? undefined,
      date: row.lastMessageAt?.toISOString(),
      body,
      messageCount: row.messageCount,
      unread: row.unread,
      labelIds: row.labelIds ?? [],
      suggestedReplyTo: row.fromAddress ?? undefined,
      messages: [
        {
          id: `${row.threadId}-msg-1`,
          from: fromDisplay,
          body,
          snippet: body.slice(0, 180),
          date: row.lastMessageAt?.toISOString(),
        },
      ],
    };
  },

  /** Remove a single thread from cache (e.g. after archive). */
  async remove(userId: string, threadId: string): Promise<void> {
    try {
      await db
        .delete(threadMailCacheTable)
        .where(
          and(
            eq(threadMailCacheTable.userId, userId),
            eq(threadMailCacheTable.threadId, threadId),
          ),
        );
    } catch (error) {
      logger.warn("Mail cache remove failed", {
        userId,
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
