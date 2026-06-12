import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";
import type {
  InboxConnectionStatus,
  InboxDraft,
  InboxService,
  InboxThread,
  ListThreadsOptions,
} from "@repo/services/inbox";

import { getCorsair, getCorsairGmailRedirectUri, isCorsairConfigured } from "../corsair";
import { getCorsairOAuthModule } from "../corsair-imports";
import {
  buildRawEmail,
  collectMessageHeaders,
  decodeHtmlEntities,
  displaySender,
  getHeader,
  normalizeSubject,
  parseEmailAddress,
  parseGmailMessage,
  suggestReplyTo,
} from "../utils/gmail-message";
import { ensureCorsairTenant } from "./corsair-tenant";
import type { SelectMailCacheRow } from "@repo/database/schema";

import { mailCache, type CachedThreadMetadata } from "./mail-cache";

const LIST_METADATA_HEADERS = ["Subject", "From", "Date"];
const ENRICH_CONCURRENCY = 6;

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

    try {
      await ensureCorsairTenant(tenantId);
      const corsair = getCorsair();
      const status = await corsair.manage.connectionStatus.get({ tenantId });
      return { gmail: status.gmail ?? "not_connected" };
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

  async listThreads(
    tenantId: string,
    opts?: ListThreadsOptions,
  ): Promise<{ threads: InboxThread[]; nextPageToken?: string }> {
    if (!this.isConfigured()) {
      return { threads: [] };
    }

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      return { threads: [] };
    }

    const maxResults = Math.min(Math.max(opts?.maxResults ?? 25, 1), 100);
    const query = opts?.query?.trim();

    const corsair = getCorsair().withTenant(tenantId);

    let listResult: { threads?: Array<{ id?: string }>; nextPageToken?: string };
    try {
      listResult = await corsair.gmail.api.threads.list({
        maxResults,
        pageToken: opts?.pageToken,
        // A search query spans all mail; an unfiltered view stays scoped to INBOX.
        labelIds: query ? undefined : ["INBOX"],
        q: query || undefined,
      });
    } catch (error) {
      logger.warn("Gmail thread list failed, serving local cache", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
      const threads = query
        ? await mailCache.search(tenantId, query, maxResults)
        : await mailCache.recent(tenantId, maxResults);
      return { threads };
    }

    const ids = (listResult.threads ?? [])
      .map((thread) => thread.id)
      .filter((id): id is string => Boolean(id));

    const enriched = await this.enrichThreads(tenantId, corsair, ids);

    return { threads: enriched, nextPageToken: listResult.nextPageToken };
  }

  /**
   * Gmail's thread list lacks headers, so we hydrate each row with a cheap
   * `metadata` get. Corsair passes `metadataHeaders` as a comma-separated query
   * param, which Gmail ignores — so we fall back to `messages.get(format=full)`
   * when Subject/From are missing.
   */
  private async enrichThreads(
    tenantId: string,
    corsair: ReturnType<ReturnType<typeof getCorsair>["withTenant"]>,
    ids: string[],
  ): Promise<InboxThread[]> {
    if (ids.length === 0) return [];

    const cache = await mailCache.getHistoryMap(tenantId, ids);
    const toPersist: CachedThreadMetadata[] = [];

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

    return threads;
  }

  /** Subject from the first message; sender/date from the latest. */
  private async resolveListMetadata(
    corsair: ReturnType<ReturnType<typeof getCorsair>["withTenant"]>,
    messages: GmailMetadataMessage[],
  ): Promise<{ subject?: string; fromRaw?: string; dateHeader?: string }> {
    const first = messages[0];
    const last = messages[messages.length - 1] ?? first;

    let subjectHeaders = collectMessageHeaders(first?.payload);
    let fromHeaders = collectMessageHeaders(last?.payload);

    if (!getHeader(subjectHeaders, "Subject")?.trim() && first?.id) {
      subjectHeaders = await this.loadMessageHeaders(corsair, first.id);
    }
    if (!getHeader(fromHeaders, "From")?.trim() && last?.id) {
      fromHeaders =
        last.id === first?.id ? subjectHeaders : await this.loadMessageHeaders(corsair, last.id);
    }

    const normalized = normalizeSubject(getHeader(subjectHeaders, "Subject"));
    const subject = normalized === "No subject" ? undefined : normalized;
    const fromRaw = getHeader(fromHeaders, "From");
    const dateHeader = getHeader(fromHeaders, "Date") ?? getHeader(subjectHeaders, "Date");

    return { subject, fromRaw, dateHeader };
  }

  private async loadMessageHeaders(
    corsair: ReturnType<ReturnType<typeof getCorsair>["withTenant"]>,
    messageId: string,
  ) {
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

    const maxResults = Math.min(Math.max(opts?.maxResults ?? 25, 1), 100);
    const corsair = getCorsair().withTenant(tenantId);
    const result = await corsair.gmail.api.drafts.list({
      maxResults,
      pageToken: opts?.pageToken,
    });

    const draftRefs: DraftRef[] = [];
    for (const draft of (result.drafts ?? []) as GmailDraftListItem[]) {
      if (draft.id) draftRefs.push({ id: draft.id, messageId: draft.message?.id });
    }

    const drafts = await mapWithConcurrency(draftRefs, ENRICH_CONCURRENCY, async (ref: DraftRef) => {
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

  async getThread(
    tenantId: string,
    threadId: string,
    opts?: { userEmail?: string },
  ): Promise<InboxThread | null> {
    if (!this.isConfigured()) return null;

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") return null;

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
    };
  }

  async sendMessage(
    tenantId: string,
    input: { to: string; subject: string; body: string; threadId?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
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
    input: { to: string; subject: string; body: string; threadId?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
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
}
