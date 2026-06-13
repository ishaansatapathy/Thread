import { and, desc, eq, ilike, or, sql } from "@repo/database";
import db from "@repo/database";
import { threadContactsTable, threadMailCacheTable } from "@repo/database/schema";
import { getInboxService } from "@repo/services/inbox";

import type { ContactsService, ThreadContact } from "@repo/services/contacts";
import { deriveContactHandle } from "@repo/services/contacts";

import { getCorsair } from "../corsair";
import { ensureCorsairTenant } from "./corsair-tenant";
import { mailCache } from "./mail-cache";
import { fetchInWaves } from "../utils/gmail-batch";
import { displaySender, findHeaderInThreadMessages, parseEmailAddress } from "../utils/gmail-message";

function rowToContact(row: typeof threadContactsTable.$inferSelect): ThreadContact {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName ?? undefined,
    handle: row.handle,
    source: row.source,
    lastUsedAt: row.lastUsedAt?.toISOString(),
  };
}

/** Parses "Name <email@x.com>" or bare email from inbox thread fields. */
export function parseThreadSender(from?: string, fromName?: string) {
  const raw = from?.trim() || fromName?.trim();
  if (!raw) return null;

  const email = parseEmailAddress(raw).toLowerCase();
  if (!email.includes("@")) return null;

  let displayName = fromName?.trim();
  if (!displayName && from?.includes("<")) {
    displayName = from.replace(/<[^>]+>/, "").trim().replace(/^["']|["']$/g, "") || undefined;
  }

  return { email, displayName };
}

export class DbContactsService implements ContactsService {
  async search(userId: string, query: string, limit = 8): Promise<ThreadContact[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const pattern = `${q}%`;
    const rows = await db
      .select()
      .from(threadContactsTable)
      .where(
        and(
          eq(threadContactsTable.userId, userId),
          or(
            ilike(threadContactsTable.handle, pattern),
            ilike(threadContactsTable.displayName, pattern),
            ilike(threadContactsTable.email, pattern),
          ),
        ),
      )
      .orderBy(desc(threadContactsTable.lastUsedAt), threadContactsTable.displayName)
      .limit(Math.min(Math.max(limit, 1), 20));

    return rows.map(rowToContact);
  }

  async upsert(
    userId: string,
    input: { email: string; displayName?: string; source?: ThreadContact["source"] },
  ): Promise<ThreadContact> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName?.trim() || undefined;
    const handle = deriveContactHandle(email, displayName);
    const source = input.source ?? "manual";

    const existing = await db
      .select()
      .from(threadContactsTable)
      .where(and(eq(threadContactsTable.userId, userId), eq(threadContactsTable.email, email)))
      .limit(1);

    if (existing[0]) {
      const [updated] = await db
        .update(threadContactsTable)
        .set({
          displayName: displayName ?? existing[0].displayName,
          handle,
          source: existing[0].source === "manual" ? source : existing[0].source,
          updatedAt: new Date(),
        })
        .where(eq(threadContactsTable.id, existing[0].id))
        .returning();
      return rowToContact(updated!);
    }

    const [inserted] = await db
      .insert(threadContactsTable)
      .values({
        userId,
        email,
        displayName,
        handle,
        source,
      })
      .returning();

    return rowToContact(inserted!);
  }

  async syncFromInbox(userId: string): Promise<{ imported: number; fromCache: number; fromLive: number }> {
    let fromCache = 0;
    let fromLive = 0;

    const cacheSenders = await db
      .selectDistinct({
        email: threadMailCacheTable.fromAddress,
        displayName: threadMailCacheTable.fromName,
      })
      .from(threadMailCacheTable)
      .where(
        and(
          eq(threadMailCacheTable.userId, userId),
          sql`${threadMailCacheTable.fromAddress} IS NOT NULL`,
        ),
      );

    for (const sender of cacheSenders) {
      const parsed = parseThreadSender(sender.email ?? undefined, sender.displayName ?? undefined);
      if (!parsed) continue;
      await this.upsert(userId, {
        email: parsed.email,
        displayName: parsed.displayName,
        source: "inbox",
      });
      fromCache += 1;
    }

    try {
      const inbox = getInboxService();
      const cached = await inbox.listCachedThreads(userId, { limit: 50 });
      const live = await inbox.listThreads(userId, { maxResults: 50 });

      const threads = new Map<string, { from?: string; fromName?: string }>();
      for (const thread of [...cached.threads, ...live.threads]) {
        if (!threads.has(thread.id)) {
          threads.set(thread.id, { from: thread.from, fromName: thread.fromName });
        }
      }

      for (const { from, fromName } of threads.values()) {
        const parsed = parseThreadSender(from, fromName);
        if (!parsed) continue;
        await this.upsert(userId, {
          email: parsed.email,
          displayName: parsed.displayName,
          source: "inbox",
        });
        fromLive += 1;
      }
    } catch {
      /* inbox may be disconnected — cache-only sync still helps */
    }

    return { imported: fromCache + fromLive, fromCache, fromLive };
  }

  async syncInboxBatch(
    userId: string,
    opts?: { pageToken?: string; pageSize?: number },
  ): Promise<{
    imported: number;
    threadsScanned: number;
    nextPageToken?: string;
    done: boolean;
    resultSizeEstimate?: number;
  }> {
    const inbox = getInboxService();
    const status = await inbox.getConnectionStatus(userId);
    if (status.gmail !== "connected") {
      return { imported: 0, threadsScanned: 0, done: true };
    }

    const pageSize = Math.min(Math.max(opts?.pageSize ?? 25, 1), 50);
    await ensureCorsairTenant(userId);
    const corsair = getCorsair().withTenant(userId);

    const listResult = (await corsair.gmail.api.threads.list({
      maxResults: pageSize,
      pageToken: opts?.pageToken,
      labelIds: ["INBOX"],
    })) as {
      threads?: Array<{ id?: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    };

    const ids = (listResult.threads ?? [])
      .map((thread) => thread.id)
      .filter((id): id is string => Boolean(id));

    if (ids.length === 0) {
      return {
        imported: 0,
        threadsScanned: 0,
        nextPageToken: listResult.nextPageToken,
        done: !listResult.nextPageToken,
        resultSizeEstimate: listResult.resultSizeEstimate,
      };
    }

    const cache = await mailCache.getHistoryMap(userId, ids);
    let imported = 0;
    const needsLive: string[] = [];

    for (const id of ids) {
      const row = cache.get(id);
      if (row?.fromAddress?.includes("@")) {
        const parsed = parseThreadSender(row.fromAddress, row.fromName ?? undefined);
        if (parsed) {
          await this.upsert(userId, {
            email: parsed.email,
            displayName: parsed.displayName,
            source: "inbox",
          });
          imported += 1;
          continue;
        }
      }
      needsLive.push(id);
    }

    type GmailHeader = { name?: string; value?: string };
    type GmailMessage = { payload?: { headers?: GmailHeader[] } };

    await fetchInWaves(needsLive, 15, async (threadId) => {
      try {
        const detail = (await corsair.gmail.api.threads.get({
          id: threadId,
          format: "metadata",
          metadataHeaders: ["From"],
        })) as { messages?: GmailMessage[] };

        const messages = detail.messages ?? [];
        const fromRaw = findHeaderInThreadMessages(messages, "From", "last");
        const parsed = parseThreadSender(fromRaw, fromRaw ? displaySender(fromRaw) : undefined);
        if (parsed) {
          await this.upsert(userId, {
            email: parsed.email,
            displayName: parsed.displayName,
            source: "inbox",
          });
          imported += 1;
        }
      } catch {
        /* skip thread */
      }
      return null;
    });

    return {
      imported,
      threadsScanned: ids.length,
      nextPageToken: listResult.nextPageToken,
      done: !listResult.nextPageToken,
      resultSizeEstimate: listResult.resultSizeEstimate,
    };
  }

  async touch(userId: string, email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await db
      .update(threadContactsTable)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(threadContactsTable.userId, userId), eq(threadContactsTable.email, normalized)));
  }
}
