import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";
import { serviceError } from "@repo/services/errors";
import type {
  InboxConnectionStatus,
  InboxDraft,
  InboxService,
  InboxThread,
  ListThreadsOptions,
  ListThreadsResult,
} from "@repo/services/inbox";
import { INBOX_PAGE_SIZE } from "@repo/services/inbox";

import { getCorsair, getCorsairGmailRedirectUri, isCorsairConfigured } from "../corsair";
import { getCorsairOAuthModule } from "../corsair-imports";
import {
  buildRawEmail,
  collectMessageHeaders,
  decodeHtmlEntities,
  displaySender,
  findHeaderInThreadMessages,
  getHeader,
  normalizeSubject,
  parseEmailAddress,
  parseGmailMessage,
  suggestReplyTo,
} from "../utils/gmail-message";
import { ensureCorsairTenant } from "./corsair-tenant";

// ── Corsair SDK typed wrappers ────────────────────────────────────────────────
import type { SelectMailCacheRow } from "@repo/database/schema";

import { mailCache, type CachedThreadMetadata } from "./mail-cache";
import { filterDemoFixtureThreads, isDemoUserId } from "./demo-user";
import {
  searchGmailMessagesDb,
  searchGmailThreadsDb,
  searchGmailDraftsDb,
  searchGmailLabelsDb,
} from "./corsair-db";
import { fetchInWaves } from "../utils/gmail-batch";
import { incrementCounter } from "../metrics";

// ── Connection status cache (30s TTL) ───────────────────────────────────────
// getConnectionStatus is a Corsair network call (~200ms). Caching it means
// warm-cache inbox loads don't pay the Corsair round-trip on every page view.
const CONNECTION_CACHE_TTL_MS = 30_000;
const connectionCache = new Map<string, { status: string; expiresAt: number }>();

// ── Gmail label ID cache ─────────────────────────────────────────────────────
// ensureLabel calls labels.list+create — cache by tenantId:name to avoid
// redundant API calls across requests in the same process lifetime.
const labelIdCache = new Map<string, string>();

function getCachedConnectionStatus(tenantId: string): string | null {
  const entry = connectionCache.get(tenantId);
  if (!entry || entry.expiresAt <= Date.now()) {
    connectionCache.delete(tenantId);
    return null;
  }
  return entry.status;
}

function setCachedConnectionStatus(tenantId: string, status: string) {
  connectionCache.set(tenantId, { status, expiresAt: Date.now() + CONNECTION_CACHE_TTL_MS });
}

/** Call after a successful Gmail/Calendar OAuth to force a fresh status check. */
export function invalidateConnectionCache(tenantId: string) {
  connectionCache.delete(tenantId);
}

const LIST_METADATA_HEADERS = ["Subject", "From", "Date"];
const ENRICH_WAVE_SIZE = INBOX_PAGE_SIZE;
/** Parallel Gmail metadata gets — keep low to avoid rate limits and timeouts. */
const ENRICH_CONCURRENCY = 5;
/** Gmail list via Corsair often takes 12–15s; 8s caused cache fallback without pagination token. */
const GMAIL_LIST_TIMEOUT_MS = 30_000;
const ENRICH_TIMEOUT_MS = 45_000;

type GmailHeader = { name?: string; value?: string };

type GmailMetadataMessage = {
  id?: string;
  snippet?: string;
  labelIds?: string[];
  threadId?: string;
  payload?: { headers?: GmailHeader[] };
};

type GmailDraftListItem = { id?: string; message?: { id?: string } };

type DraftRef = { id: string; messageId?: string };

/** Maps over items with a bounded concurrency so we never fan out hundreds of Gmail gets. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function parseHeaderDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isUsableCacheRow(row: SelectMailCacheRow | undefined): boolean {
  if (!row) return false;
  const subject = row.subject?.trim();
  const hasSender = Boolean(row.fromName?.trim() || row.fromAddress?.trim());
  return Boolean(subject && subject !== "No subject" && hasSender);
}

function threadFromCacheOnly(id: string, cached: SelectMailCacheRow): InboxThread {
  return {
    id,
    snippet: cached.snippet ?? "",
    historyId: cached.historyId ?? undefined,
    subject: cached.subject ?? undefined,
    from: cached.fromAddress ?? undefined,
    fromName: cached.fromName ?? undefined,
    date: cached.lastMessageAt?.toISOString(),
    messageCount: cached.messageCount ?? 1,
    unread: cached.unread ?? false,
  };
}

function mergeThreadsInOrder(ids: string[], resolved: Map<string, InboxThread>): InboxThread[] {
  return ids.map((id) => resolved.get(id)).filter((thread): thread is InboxThread => Boolean(thread));
}

function threadFromCacheRow(
  id: string,
  detail: { snippet?: string; historyId?: string },
  cached: SelectMailCacheRow,
  messages: GmailMetadataMessage[],
): InboxThread {
  const labelIds = messages.flatMap((message) => message.labelIds ?? []);
  return {
    id,
    snippet: decodeHtmlEntities(detail.snippet ?? cached.snippet ?? ""),
    historyId: detail.historyId ?? cached.historyId ?? undefined,
    subject: cached.subject ?? undefined,
    from: cached.fromAddress ?? undefined,
    fromName: cached.fromName ?? undefined,
    date: cached.lastMessageAt?.toISOString(),
    messageCount: cached.messageCount ?? messages.length,
    unread: labelIds.includes("UNREAD"),
  };
}

export class CorsairInboxService implements InboxService {
  isConfigured() {
    if (!isCorsairConfigured()) return false;
    const google = getGoogleOAuthConfig();
    return Boolean(google.clientId && google.clientSecret);
  }

  async getConnectionStatus(tenantId: string): Promise<InboxConnectionStatus> {
    if (!this.isConfigured()) {
      return { gmail: "not_configured" };
    }

    const cached = getCachedConnectionStatus(tenantId);
    if (cached) {
      return { gmail: cached as InboxConnectionStatus["gmail"] };
    }

    try {
      await ensureCorsairTenant(tenantId);
      const corsair = getCorsair();
      const status = await corsair.manage.connectionStatus.get({ tenantId });
      const gmail = status.gmail ?? "not_connected";
      setCachedConnectionStatus(tenantId, gmail);
      return { gmail };
    } catch (error) {
      logger.warn("Inbox connection status failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
      return { gmail: "not_connected" };
    }
  }

  async getGmailConnectUrl(tenantId: string, returnTo = "/inbox") {
    if (!this.isConfigured()) {
      throw new Error("Gmail integration is not configured on the server");
    }

    await ensureCorsairTenant(tenantId);
    const corsair = getCorsair();
    const redirectUri = getCorsairGmailRedirectUri();
    const { generateOAuthUrl } = getCorsairOAuthModule();
    const { url, state } = await generateOAuthUrl(corsair, "gmail", {
      tenantId,
      redirectUri,
    });

    return { url, state, returnTo, redirectUri };
  }

  async completeGmailOAuth(input: { code: string; state: string }) {
    const corsair = getCorsair();
    const redirectUri = getCorsairGmailRedirectUri();
    const { processOAuthCallback } = getCorsairOAuthModule();
    return processOAuthCallback(corsair, {
      code: input.code,
      state: input.state,
      redirectUri,
    });
  }

  async listCachedThreads(
    tenantId: string,
    opts?: { limit?: number; query?: string },
  ): Promise<{ threads: InboxThread[] }> {
    const limit = Math.min(Math.max(opts?.limit ?? INBOX_PAGE_SIZE, 1), 100);
    const query = opts?.query?.trim();

    if (this.isConfigured()) {
      try {
        const status = await this.getConnectionStatus(tenantId);
        if (status.gmail === "connected") {
          if (query) {
            const msgRows = await searchGmailMessagesDb(
              tenantId,
              {
                subject: { contains: query },
              },
              { limit },
            );
            const threadIds = [...new Set(msgRows.map((m) => m.threadId).filter(Boolean))] as string[];
            if (threadIds.length > 0) {
              return {
                threads: await this.filterDemoCacheThreads(
                  tenantId,
                  threadIds.slice(0, limit).map((id) => {
                    const msg = msgRows.find((m) => m.threadId === id);
                    return {
                      id,
                      snippet: msg?.snippet ?? "",
                      subject: msg?.subject,
                      from: msg?.from,
                    };
                  }),
                ),
              };
            }
            const threadRows = await searchGmailThreadsDb(
              tenantId,
              { snippet: { contains: query } },
              { limit },
            );
            if (threadRows.length > 0) {
              return {
                threads: await this.filterDemoCacheThreads(
                  tenantId,
                  threadRows.map((r) => ({ id: r.id, snippet: r.snippet ?? "" })),
                ),
              };
            }
          } else {
            const threadRows = await searchGmailThreadsDb(tenantId, {}, { limit });
            if (threadRows.length > 0) {
              return {
                threads: await this.filterDemoCacheThreads(
                  tenantId,
                  threadRows.map((r) => ({ id: r.id, snippet: r.snippet ?? "" })),
                ),
              };
            }
          }
        }
      } catch {
        // fall through to Postgres mail_cache
      }
    }

    const threads = query
      ? await mailCache.search(tenantId, query, limit)
      : await mailCache.recent(tenantId, limit);
    return { threads: await this.filterDemoCacheThreads(tenantId, threads) };
  }

  async listThreads(tenantId: string, opts?: ListThreadsOptions): Promise<ListThreadsResult> {
    const maxResults = Math.min(Math.max(opts?.maxResults ?? INBOX_PAGE_SIZE, 1), 100);
    const query = opts?.query?.trim();

    if (!this.isConfigured()) {
      const threads = query
        ? await mailCache.search(tenantId, query, maxResults)
        : await mailCache.recent(tenantId, maxResults);
      return { threads: await this.filterDemoCacheThreads(tenantId, threads), stale: true };
    }

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      const threads = query
        ? await mailCache.search(tenantId, query, maxResults)
        : await mailCache.recent(tenantId, maxResults);
      return { threads: await this.filterDemoCacheThreads(tenantId, threads), stale: true };
    }

    const forceRefresh = opts?.refresh === true;

    const corsair = getCorsair().withTenant(tenantId);

    let listResult: { threads?: Array<{ id?: string }>; nextPageToken?: string };
    try {
      listResult = await withTimeout(
        corsair.gmail.api.threads.list({
          maxResults,
          pageToken: opts?.pageToken,
          labelIds: query ? undefined : ["INBOX"],
          q: query || undefined,
        }),
        GMAIL_LIST_TIMEOUT_MS,
        "Gmail thread list timed out",
      );
    } catch (error) {
      logger.warn("Gmail thread list failed, serving Corsair DB / local cache", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
      incrementCounter("inbox.gmail_list_error");
      const dbRows = query
        ? await searchGmailThreadsDb(tenantId, { snippet: { contains: query } }, { limit: maxResults })
        : await searchGmailThreadsDb(tenantId, {}, { limit: maxResults });
      if (dbRows.length > 0) {
        return {
          threads: dbRows.map((r) => ({ id: r.id, snippet: r.snippet ?? "" })),
          stale: true,
        };
      }
      const threads = query
        ? await mailCache.search(tenantId, query, maxResults)
        : await mailCache.recent(tenantId, maxResults);
      return { threads, stale: true };
    }

    const ids = (listResult.threads ?? [])
      .map((thread) => thread.id)
      .filter((id): id is string => Boolean(id));

    const cache = await mailCache.getHistoryMap(tenantId, ids);

    if (!forceRefresh) {
      const allCached = ids.every((id) => isUsableCacheRow(cache.get(id)));
      if (allCached) {
        incrementCounter("inbox.cache_hit");
        void this.enrichThreads(tenantId, corsair, ids).catch((error) => {
          logger.warn("Background inbox refresh failed", {
            tenantId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
        return {
          threads: ids.map((id) => threadFromCacheOnly(id, cache.get(id)!)),
          nextPageToken: listResult.nextPageToken,
          stale: true,
        };
      }
    }

    const idsNeedingLive = forceRefresh
      ? ids
      : ids.filter((id) => !isUsableCacheRow(cache.get(id)));

    const resolved = new Map<string, InboxThread>();
    for (const id of ids) {
      const row = cache.get(id);
      if (!forceRefresh && row && isUsableCacheRow(row) && !idsNeedingLive.includes(id)) {
        resolved.set(id, threadFromCacheOnly(id, row));
      }
    }

    let enrichmentTimer: ReturnType<typeof setTimeout> | undefined;
    const partialEnriched = new Map<string, InboxThread>();
    let enrichmentFinished = false;

    const enrichPromise = this.enrichThreadsToMap(tenantId, corsair, idsNeedingLive, cache).then(
      (map) => {
        enrichmentFinished = true;
        for (const [id, thread] of map) partialEnriched.set(id, thread);
        return map;
      },
    );

    const enrichTimeoutMs = Math.max(
      ENRICH_TIMEOUT_MS,
      idsNeedingLive.length * 3_500,
    );

    const cachedFallback = new Promise<Map<string, InboxThread>>((resolve) => {
      enrichmentTimer = setTimeout(() => {
        if (enrichmentFinished) {
          resolve(partialEnriched);
          return;
        }
        logger.warn("Gmail thread enrichment timed out, serving partial cache", {
          tenantId,
          threadCount: idsNeedingLive.length,
          enrichedCount: partialEnriched.size,
        });
        const fallback = new Map<string, InboxThread>();
        for (const id of idsNeedingLive) {
          const live = partialEnriched.get(id);
          if (live?.fromName?.trim() || live?.from?.trim()) {
            fallback.set(id, live);
            continue;
          }
          const row = cache.get(id);
          fallback.set(
            id,
            row && isUsableCacheRow(row)
              ? threadFromCacheOnly(id, row)
              : (live ?? { id, snippet: row?.snippet ?? "" }),
          );
        }
        resolve(fallback);
      }, enrichTimeoutMs);
    });

    const enrichedMap = await Promise.race([enrichPromise, cachedFallback]).finally(() => {
      if (enrichmentTimer) clearTimeout(enrichmentTimer);
    });

    for (const [id, thread] of enrichedMap) {
      resolved.set(id, thread);
    }

    return {
      threads: mergeThreadsInOrder(ids, resolved),
      nextPageToken: listResult.nextPageToken,
      stale: idsNeedingLive.length === 0,
    };
  }

  /**
   * Gmail's thread list lacks headers, so we hydrate each row with a cheap
   * `metadata` get. Corsair passes `metadataHeaders` as a comma-separated query
   * param, which Gmail ignores — so we fall back to `messages.get(format=metadata)`
   * when Subject/From are missing.
   */
  private async enrichThreads(
    tenantId: string,
    corsair: ReturnType<ReturnType<typeof getCorsair>["withTenant"]>,
    ids: string[],
  ): Promise<InboxThread[]> {
    const cache = await mailCache.getHistoryMap(tenantId, ids);
    const map = await this.enrichThreadsToMap(tenantId, corsair, ids, cache);
    return mergeThreadsInOrder(ids, map);
  }

  private async enrichThreadsToMap(
    tenantId: string,
    corsair: ReturnType<ReturnType<typeof getCorsair>["withTenant"]>,
    ids: string[],
    cache: Map<string, SelectMailCacheRow>,
  ): Promise<Map<string, InboxThread>> {
    if (ids.length === 0) return new Map();

    const toPersist: CachedThreadMetadata[] = [];
    const result = new Map<string, InboxThread>();

    const threads = await mapWithConcurrency(ids, ENRICH_CONCURRENCY, async (id) => {
      try {
        const detail = await corsair.gmail.api.threads.get({
          id,
          format: "metadata",
          metadataHeaders: LIST_METADATA_HEADERS,
        });

        const messages = (detail.messages ?? []) as GmailMetadataMessage[];
        const cachedRow = cache.get(id);

        if (
          isUsableCacheRow(cachedRow) &&
          cachedRow!.historyId &&
          detail.historyId &&
          cachedRow!.historyId === detail.historyId
        ) {
          return threadFromCacheRow(id, detail, cachedRow!, messages);
        }

        const { subject, fromRaw, dateHeader } = await this.resolveListMetadata(corsair, messages);
        const labelIds = messages.flatMap(
          (message: GmailMetadataMessage) => message.labelIds ?? [],
        );
        const unread = labelIds.includes("UNREAD");
        const lastMessageAt = parseHeaderDate(dateHeader);
        const last = messages[messages.length - 1];
        const rawSnippet = detail.snippet ?? last?.snippet ?? "";

        const thread: InboxThread = {
          id,
          snippet: decodeHtmlEntities(rawSnippet),
          historyId: detail.historyId,
          subject,
          from: parseEmailAddress(fromRaw) || undefined,
          fromName: fromRaw ? displaySender(fromRaw) : undefined,
          date: lastMessageAt?.toISOString(),
          messageCount: messages.length,
          unread,
        };

        toPersist.push({
          threadId: id,
          historyId: detail.historyId,
          subject: thread.subject,
          fromName: thread.fromName,
          fromAddress: thread.from,
          snippet: thread.snippet,
          lastMessageAt,
          messageCount: messages.length,
          unread,
          labelIds: Array.from(new Set(labelIds)),
        });

        return thread;
      } catch (error) {
        logger.warn("Gmail thread metadata failed, using cache row", {
          tenantId,
          threadId: id,
          message: error instanceof Error ? error.message : String(error),
        });
        const cached = cache.get(id);
        return {
          id,
          snippet: cached?.snippet ?? "",
          historyId: cached?.historyId ?? undefined,
          subject: cached?.subject ?? undefined,
          from: cached?.fromAddress ?? undefined,
          fromName: cached?.fromName ?? undefined,
          date: cached?.lastMessageAt?.toISOString(),
          messageCount: cached?.messageCount ?? 1,
          unread: cached?.unread ?? false,
        } satisfies InboxThread;
      }
    });

    void mailCache.upsertMany(tenantId, toPersist);

    for (const thread of threads) {
      result.set(thread.id, thread);
    }
    return result;
  }

  /** Subject from the first message; sender/date from the latest. */
  private async resolveListMetadata(
    corsair: ReturnType<ReturnType<typeof getCorsair>["withTenant"]>,
    messages: GmailMetadataMessage[],
  ): Promise<{ subject?: string; fromRaw?: string; dateHeader?: string }> {
    const first = messages[0];
    const last = messages[messages.length - 1] ?? first;

    let normalized = normalizeSubject(findHeaderInThreadMessages(messages, "Subject", "first"));
    let fromRaw = findHeaderInThreadMessages(messages, "From", "last");
    let dateHeader =
      findHeaderInThreadMessages(messages, "Date", "last") ??
      findHeaderInThreadMessages(messages, "Date", "first");

    if (normalized === "No subject" && first?.id) {
      const headers = await this.loadMessageHeaders(corsair, first.id);
      normalized = normalizeSubject(getHeader(headers, "Subject"));
      dateHeader = dateHeader ?? getHeader(headers, "Date");
    }
    if (!fromRaw?.trim() && last?.id) {
      const headers = await this.loadMessageHeaders(corsair, last.id);
      fromRaw = getHeader(headers, "From") ?? fromRaw;
      dateHeader = dateHeader ?? getHeader(headers, "Date");
    }

    const subject = normalized === "No subject" ? undefined : normalized;
    return { subject, fromRaw, dateHeader };
  }

  private async loadMessageHeaders(
    corsair: ReturnType<ReturnType<typeof getCorsair>["withTenant"]>,
    messageId: string,
  ) {
    try {
      const detail = await corsair.gmail.api.messages.get({
        id: messageId,
        format: "metadata",
        metadataHeaders: LIST_METADATA_HEADERS,
      });
      const headers = collectMessageHeaders(detail.payload as GmailMetadataMessage["payload"]);
      if (getHeader(headers, "From")?.trim() || getHeader(headers, "Subject")?.trim()) {
        return headers;
      }
    } catch (error) {
      logger.debug("Gmail metadata headers fetch failed, trying full format", {
        messageId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const detail = await corsair.gmail.api.messages.get({
      id: messageId,
      format: "full",
    });
    return collectMessageHeaders(detail.payload as GmailMetadataMessage["payload"]);
  }

  async listDrafts(
    tenantId: string,
    opts?: { maxResults?: number; pageToken?: string },
  ): Promise<{ drafts: InboxDraft[]; nextPageToken?: string }> {
    if (!this.isConfigured()) return { drafts: [] };

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") return { drafts: [] };

    const maxResults = Math.min(Math.max(opts?.maxResults ?? INBOX_PAGE_SIZE, 1), 100);
    const corsair = getCorsair().withTenant(tenantId);
    const result = await corsair.gmail.api.drafts.list({
      maxResults,
      pageToken: opts?.pageToken,
    });

    const draftRefs: DraftRef[] = [];
    for (const draft of (result.drafts ?? []) as GmailDraftListItem[]) {
      if (draft.id) draftRefs.push({ id: draft.id, messageId: draft.message?.id });
    }

    const drafts = await fetchInWaves(draftRefs, ENRICH_WAVE_SIZE, async (ref: DraftRef) => {
      try {
        const detail = await corsair.gmail.api.drafts.get({ id: ref.id, format: "metadata" });
        const message = detail.message;
        const headers = (message?.payload?.headers ?? []) as GmailHeader[];
        return {
          id: ref.id,
          messageId: message?.id,
          threadId: message?.threadId,
          subject: getHeader(headers, "Subject")?.trim() || "(no subject)",
          to: parseEmailAddress(getHeader(headers, "To")) || undefined,
          snippet: message?.snippet ?? "",
          updatedAt: parseHeaderDate(getHeader(headers, "Date"))?.toISOString(),
        } satisfies InboxDraft;
      } catch (error) {
        logger.warn("Gmail draft metadata failed", {
          tenantId,
          draftId: ref.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return { id: ref.id, snippet: "" } satisfies InboxDraft;
      }
    });

    return { drafts, nextPageToken: result.nextPageToken };
  }

  async getDraft(
    tenantId: string,
    draftId: string,
  ): Promise<{ id: string; to?: string; subject?: string; body: string; threadId?: string } | null> {
    if (!this.isConfigured()) return null;

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") return null;

    const corsair = getCorsair().withTenant(tenantId);
    try {
      const detail = await corsair.gmail.api.drafts.get({ id: draftId, format: "full" });
      const message = detail.message;
      if (!message) return null;
      const headers = collectMessageHeaders(message.payload as GmailMetadataMessage["payload"]);
      const parsed = parseGmailMessage(message as Parameters<typeof parseGmailMessage>[0]);
      return {
        id: draftId,
        to: parseEmailAddress(getHeader(headers, "To")) || undefined,
        subject: getHeader(headers, "Subject")?.trim() || "(no subject)",
        body: parsed?.body || message.snippet || "",
        threadId: message.threadId,
      };
    } catch (error) {
      logger.warn("Gmail draft fetch failed", {
        tenantId,
        draftId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getThread(
    tenantId: string,
    threadId: string,
    opts?: { userEmail?: string },
  ): Promise<InboxThread | null> {
    if (!this.isConfigured()) {
      return mailCache.getThread(tenantId, threadId);
    }

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      return mailCache.getThread(tenantId, threadId);
    }

    const corsair = getCorsair().withTenant(tenantId);
    const thread = await corsair.gmail.api.threads.get({
      id: threadId,
      format: "full",
    });

    if (!thread.id) return null;

    const messages = ((thread.messages ?? []) as Array<Parameters<typeof parseGmailMessage>[0]>)
      .map((message) => parseGmailMessage(message))
      .filter((message): message is NonNullable<typeof message> => Boolean(message));

    if (messages.length === 0) return null;

    const firstHeaders = thread.messages?.[0]?.payload?.headers ?? [];
    const subject = normalizeSubject(getHeader(firstHeaders, "Subject"));
    const last = messages[messages.length - 1]!;

    return {
      id: thread.id,
      snippet: thread.snippet ?? last.snippet,
      historyId: thread.historyId,
      subject,
      from: last.from,
      to: last.to,
      date: last.date,
      body: last.body,
      messageId: last.id,
      messages,
      messageCount: messages.length,
      suggestedReplyTo: suggestReplyTo(messages, opts?.userEmail),
      // Aggregate labelIds across all messages so UI can show starred/important state
      labelIds: Array.from(
        new Set(
          (thread.messages ?? []).flatMap(
            (m: { labelIds?: string[] }) => m.labelIds ?? [],
          ),
        ),
      ),
    };
  }

  async sendMessage(
    tenantId: string,
    input: {
      to: string;
      subject: string;
      body: string;
      threadId?: string;
      cc?: string;
      bcc?: string;
      attachments?: Array<{ filename: string; mimeType: string; contentBase64: string }>;
    },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw serviceError("PRECONDITION_FAILED", "Connect Gmail in Settings to send this email.");
    }

    const corsair = getCorsair().withTenant(tenantId);
    const raw = buildRawEmail(input);
    const result = await corsair.gmail.api.messages.send({
      raw,
      threadId: input.threadId,
    });

    return { id: result.id, threadId: result.threadId ?? input.threadId };
  }

  async createDraft(
    tenantId: string,
    input: {
      to: string;
      subject: string;
      body: string;
      threadId?: string;
      cc?: string;
      bcc?: string;
      attachments?: Array<{ filename: string; mimeType: string; contentBase64: string }>;
    },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw serviceError("PRECONDITION_FAILED", "Connect Gmail in Settings to save this draft.");
    }

    const corsair = getCorsair().withTenant(tenantId);
    const raw = buildRawEmail(input);
    const result = await corsair.gmail.api.drafts.create({
      draft: {
        message: {
          raw,
          threadId: input.threadId,
        },
      },
    });

    return { id: result.id };
  }

  async markThreadRead(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({
      id: threadId,
      removeLabelIds: ["UNREAD"],
    });

    await mailCache.upsertMany(tenantId, [{ threadId, unread: false }]);
  }

  async markThreadUnread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({
      id: threadId,
      addLabelIds: ["UNREAD"],
    });

    await mailCache.upsertMany(tenantId, [{ threadId, unread: true }]);
  }

  async archiveThread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({
      id: threadId,
      removeLabelIds: ["INBOX"],
    });

    await mailCache.remove(tenantId, threadId);
  }

  async listLabels(tenantId: string): Promise<Array<{ id: string; name: string; type?: string }>> {
    try {
      const corsair = getCorsair().withTenant(tenantId);
      const result = await corsair.gmail.api.labels.list({});
      const labels = result.labels ?? [];
      return labels
        .filter((l: { id?: string; name?: string; type?: string }) => l.id && l.name)
        .map((l: { id?: string; name?: string; type?: string }) => ({ id: l.id!, name: l.name!, type: l.type }));
    } catch (error) {
      logger.warn("listLabels failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async applyLabel(tenantId: string, threadId: string, labelId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({ id: threadId, addLabelIds: [labelId] });
  }

  async removeLabel(tenantId: string, threadId: string, labelId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({ id: threadId, removeLabelIds: [labelId] });
  }

  /** Star a thread via Corsair Gmail — adds STARRED system label. */
  async starThread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({ id: threadId, addLabelIds: ["STARRED"] });
  }

  /** Unstar a thread via Corsair Gmail — removes STARRED system label. */
  async unstarThread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({ id: threadId, removeLabelIds: ["STARRED"] });
  }

  /** Mark thread as important via Corsair Gmail — adds IMPORTANT system label. */
  async markImportant(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({ id: threadId, addLabelIds: ["IMPORTANT"] });
  }

  /** Remove important flag via Corsair Gmail — removes IMPORTANT system label. */
  async markNotImportant(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({ id: threadId, removeLabelIds: ["IMPORTANT"] });
  }

  /**
   * Ensure a Gmail label exists (creating it via Corsair if missing) and return its ID.
   * Uses a per-tenant in-memory cache to avoid redundant label list+create calls.
   */
  async ensureLabel(
    tenantId: string,
    name: string,
    opts?: { backgroundColor?: string; textColor?: string },
  ): Promise<string> {
    const cacheKey = `${tenantId}:${name}`;
    if (labelIdCache.has(cacheKey)) return labelIdCache.get(cacheKey)!;

    const corsair = getCorsair().withTenant(tenantId);
    const labelsApi = corsair.gmail.api.labels as {
      list: (opts?: Record<string, unknown>) => Promise<{ labels?: Array<{ id?: string; name?: string }> } | Array<{ id?: string; name?: string }>>;
      create: (opts: Record<string, unknown>) => Promise<{ id?: string; name?: string }>;
    };

    const result = await labelsApi.list({});
    const labels = Array.isArray(result) ? result : (result.labels ?? []);
    const existing = labels.find((l) => l.name === name);
    if (existing?.id) {
      labelIdCache.set(cacheKey, existing.id);
      return existing.id;
    }

    const created = await labelsApi.create({
      label: {
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
        ...(opts?.backgroundColor || opts?.textColor
          ? { color: { backgroundColor: opts.backgroundColor, textColor: opts.textColor } }
          : {}),
      },
    });

    if (!created.id) throw new Error(`Failed to create Gmail label: ${name}`);
    labelIdCache.set(cacheKey, created.id);
    return created.id;
  }

  /**
   * Apply AI-derived Gmail labels to threads based on urgency/category.
   * Creates the labels if they don't exist. Fire-and-forget safe (non-fatal on error).
   * Labels applied:
   *   urgency=critical  → "Corsair/Critical"
   *   urgency=high      → "Corsair/High Priority"
   *   category=reply_needed → "Corsair/Reply Needed"
   *   category=deadline → "Corsair/Deadline"
   */
  async autoLabelThreads(
    tenantId: string,
    items: Array<{
      id: string;
      urgency: "critical" | "high" | "medium" | "low" | "noise";
      category: "reply_needed" | "deadline" | "meeting" | "billing" | "fyi" | "promo";
    }>,
  ): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") return;

    // Determine which labels we'll need.
    const needsCritical = items.some((i) => i.urgency === "critical");
    const needsHigh = items.some((i) => i.urgency === "high" || i.urgency === "critical");
    const needsReply = items.some((i) => i.category === "reply_needed");
    const needsDeadline = items.some((i) => i.category === "deadline");

    const [criticalId, highId, replyId, deadlineId] = await Promise.all([
      needsCritical ? this.ensureLabel(tenantId, "Corsair/Critical", { backgroundColor: "#cc3a21", textColor: "#ffffff" }) : Promise.resolve(null),
      needsHigh ? this.ensureLabel(tenantId, "Corsair/High Priority", { backgroundColor: "#e66550", textColor: "#ffffff" }) : Promise.resolve(null),
      needsReply ? this.ensureLabel(tenantId, "Corsair/Reply Needed", { backgroundColor: "#f2a60c", textColor: "#ffffff" }) : Promise.resolve(null),
      needsDeadline ? this.ensureLabel(tenantId, "Corsair/Deadline", { backgroundColor: "#ffd6a2", textColor: "#000000" }) : Promise.resolve(null),
    ]);

    const corsair = getCorsair().withTenant(tenantId);
    await Promise.all(
      items.map(async (item) => {
        const addLabelIds: string[] = [];
        if (item.urgency === "critical" && criticalId) addLabelIds.push(criticalId);
        if ((item.urgency === "critical" || item.urgency === "high") && highId) addLabelIds.push(highId);
        if (item.category === "reply_needed" && replyId) addLabelIds.push(replyId);
        if (item.category === "deadline" && deadlineId) addLabelIds.push(deadlineId);
        if (addLabelIds.length === 0) return;
        try {
          await corsair.gmail.api.threads.modify({ id: item.id, addLabelIds });
        } catch {
          // Non-fatal — label apply is best-effort
        }
      }),
    );
  }

  async trashThread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.trash({ id: threadId });
  }

  async updateDraft(
    tenantId: string,
    draftId: string,
    input: {
      to: string;
      subject: string;
      body: string;
      threadId?: string;
      cc?: string;
      bcc?: string;
    },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    const raw = buildRawEmail(input);
    const result = await corsair.gmail.api.drafts.update({
      id: draftId,
      draft: { message: { raw, threadId: input.threadId } },
    });
    return { id: result.id };
  }

  async getLabel(tenantId: string, labelId: string) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    const label = await corsair.gmail.api.labels.get({ id: labelId });
    if (!label.id || !label.name) return null;
    return { id: label.id, name: label.name, type: label.type };
  }

  async updateLabel(
    tenantId: string,
    labelId: string,
    label: { name?: string; labelListVisibility?: string; messageListVisibility?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    const updated = await corsair.gmail.api.labels.update({
      id: labelId,
      label: {
        name: label.name,
        labelListVisibility: label.labelListVisibility as "labelShow" | "labelShowIfUnread" | "labelHide" | undefined,
        messageListVisibility: label.messageListVisibility as "show" | "hide" | undefined,
      },
    });
    return { id: updated.id ?? labelId, name: updated.name ?? label.name ?? labelId };
  }

  async deleteLabel(tenantId: string, labelId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.labels.delete({ id: labelId });
  }

  async listMessages(
    tenantId: string,
    opts?: { maxResults?: number; pageToken?: string; q?: string; labelIds?: string[] },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    const result = await corsair.gmail.api.messages.list({
      maxResults: opts?.maxResults,
      pageToken: opts?.pageToken,
      q: opts?.q,
      labelIds: opts?.labelIds,
    });
    return {
      messages: (result.messages ?? [])
        .filter((m: { id?: string }) => m.id)
        .map((m: { id?: string; threadId?: string; snippet?: string }) => ({ id: m.id!, threadId: m.threadId, snippet: m.snippet })),
      nextPageToken: result.nextPageToken,
    };
  }

  async modifyMessage(
    tenantId: string,
    messageId: string,
    opts: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.messages.modify({
      id: messageId,
      addLabelIds: opts.addLabelIds,
      removeLabelIds: opts.removeLabelIds,
    });
  }

  async batchModifyMessages(
    tenantId: string,
    opts: { ids: string[]; addLabelIds?: string[]; removeLabelIds?: string[] },
  ): Promise<void> {
    if (opts.ids.length === 0) return;
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.messages.batchModify({
      ids: opts.ids,
      addLabelIds: opts.addLabelIds,
      removeLabelIds: opts.removeLabelIds,
    });
  }

  async batchModifyThreads(
    tenantId: string,
    opts: { threadIds: string[]; addLabelIds?: string[]; removeLabelIds?: string[] },
  ): Promise<{ modifiedMessages: number }> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    const messageIds: string[] = [];
    for (const threadId of opts.threadIds) {
      const thread = await corsair.gmail.api.threads.get({ id: threadId, format: "minimal" });
      for (const msg of thread.messages ?? []) {
        if (msg.id) messageIds.push(msg.id);
      }
    }
    if (messageIds.length > 0) {
      await corsair.gmail.api.messages.batchModify({
        ids: messageIds,
        addLabelIds: opts.addLabelIds,
        removeLabelIds: opts.removeLabelIds,
      });
    }
    if (opts.removeLabelIds?.includes("INBOX")) {
      for (const threadId of opts.threadIds) {
        await mailCache.remove(tenantId, threadId);
      }
    }
    if (opts.removeLabelIds?.includes("UNREAD")) {
      await mailCache.upsertMany(
        tenantId,
        opts.threadIds.map((threadId) => ({ threadId, unread: false })),
      );
    }
    return { modifiedMessages: messageIds.length };
  }

  async trashMessage(tenantId: string, messageId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.messages.trash({ id: messageId });
  }

  async untrashMessage(tenantId: string, messageId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.messages.untrash({ id: messageId });
  }

  async deleteMessage(tenantId: string, messageId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.messages.delete({ id: messageId });
  }

  async deleteThread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.delete({ id: threadId });
    await mailCache.remove(tenantId, threadId);
  }

  async untrashThread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.untrash({ id: threadId });
  }

  async searchThreadsDb(tenantId: string, opts?: { query?: string; limit?: number; offset?: number }) {
    const data = opts?.query?.trim()
      ? { snippet: { contains: opts.query.trim() } }
      : {};
    const rows = await searchGmailThreadsDb(tenantId, data, {
      limit: opts?.limit,
      offset: opts?.offset,
    });
    return {
      threads: rows.map((r) => ({ id: r.id, snippet: r.snippet ?? "", historyId: r.historyId })),
    };
  }

  async searchMessagesDb(
    tenantId: string,
    opts?: { query?: string; from?: string; limit?: number; offset?: number },
  ) {
    const data: Record<string, unknown> = {};
    if (opts?.query?.trim()) data.subject = { contains: opts.query.trim() };
    if (opts?.from?.trim()) data.from = { contains: opts.from.trim() };
    const rows = await searchGmailMessagesDb(tenantId, data, {
      limit: opts?.limit,
      offset: opts?.offset,
    });
    return { messages: rows };
  }

  async searchDraftsDb(tenantId: string, opts?: { limit?: number; offset?: number }) {
    const rows = await searchGmailDraftsDb(tenantId, {}, opts);
    return { drafts: rows };
  }

  async searchLabelsDb(tenantId: string, opts?: { name?: string; limit?: number; offset?: number }) {
    const data = opts?.name?.trim() ? { name: { contains: opts.name.trim() } } : {};
    const rows = await searchGmailLabelsDb(tenantId, data, opts);
    return { labels: rows };
  }

  async muteThread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({
      id: threadId,
      addLabelIds: ["MUTE"],
      removeLabelIds: ["INBOX"],
    });
    await mailCache.remove(tenantId, threadId);
  }

  async unmuteThread(tenantId: string, threadId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.threads.modify({
      id: threadId,
      removeLabelIds: ["MUTE"],
      addLabelIds: ["INBOX"],
    });
  }

  async deleteDraft(tenantId: string, draftId: string): Promise<void> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") throw new Error("Gmail is not connected");
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.gmail.api.drafts.delete({ id: draftId });
  }

  async sendDraft(tenantId: string, draftId: string): Promise<{ id?: string; threadId?: string }> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw serviceError("PRECONDITION_FAILED", "Connect Gmail in Settings to send this draft.");
    }
    const corsair = getCorsair().withTenant(tenantId);
    const result = await corsair.gmail.api.drafts.send({ id: draftId });
    return { id: result.id, threadId: result.threadId };
  }

  async registerGmailWatch(tenantId: string): Promise<void> {
    const topicId = process.env.CORSAIR_GMAIL_TOPIC_ID?.trim();
    if (!topicId) {
      logger.info("CORSAIR_GMAIL_TOPIC_ID not set — skipping Gmail watch registration");
      return;
    }

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    const result = await (corsair.gmail.api.users as {
      watch?: (opts: {
        userId: string;
        topicName: string;
        labelIds?: string[];
      }) => Promise<{ historyId?: string }>;
    }).watch?.({
      userId: "me",
      topicName: topicId,
      labelIds: ["INBOX"],
    });

    if (!result) {
      throw new Error("Gmail watch API is not available");
    }

    if (result.historyId) {
      const { setLastHistoryId } = await import("./gmail-state");
      await setLastHistoryId(tenantId, result.historyId);
    }

    logger.info("Gmail Pub/Sub watch registered", { tenantId, topicId });
  }

  async disconnect(tenantId: string): Promise<void> {
    const { disconnectCorsairConnection } = await import("./corsair-disconnect");
    await disconnectCorsairConnection(tenantId, "gmail");
    invalidateConnectionCache(tenantId);
  }

  /** Shared demo account: hide real Gmail synced into cache when OAuth is disconnected. */
  private async filterDemoCacheThreads(tenantId: string, threads: InboxThread[]): Promise<InboxThread[]> {
    if (!(await isDemoUserId(tenantId))) return threads;
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail === "connected") return threads;
    return filterDemoFixtureThreads(threads, true);
  }
}
