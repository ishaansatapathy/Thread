/**
 * Corsair local DB search layer — gmail.db.* and googlecalendar.db.*
 * Falls back gracefully when DB is unavailable or empty.
 */
import { logger } from "@repo/logger";

import { getCorsair, isCorsairConfigured } from "../corsair";

export type CorsairDbFilter = Record<string, unknown>;

export type DbSearchOptions = {
  limit?: number;
  offset?: number;
};

type TenantClient = ReturnType<ReturnType<typeof getCorsair>["withTenant"]>;

function withTenantDb(tenantId: string): TenantClient | null {
  if (!isCorsairConfigured()) return null;
  try {
    return getCorsair().withTenant(tenantId);
  } catch {
    return null;
  }
}

async function runSearch<T>(
  label: string,
  tenantId: string,
  fn: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await fn();
  } catch (error) {
    logger.warn(`${label} failed`, {
      tenantId,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function searchGmailThreadsDb(
  tenantId: string,
  data: CorsairDbFilter,
  opts?: DbSearchOptions,
): Promise<Array<{ id: string; snippet?: string; historyId?: string }>> {
  const corsair = withTenantDb(tenantId);
  const search = corsair?.gmail?.db?.threads?.search;
  if (!search) return [];

  return runSearch("gmail.db.threads.search", tenantId, async () => {
    const rows = (await search({
      data,
      limit: opts?.limit ?? 50,
      offset: opts?.offset ?? 0,
    })) as Array<{ id?: string; snippet?: string; historyId?: string }>;
    return rows
      .filter((r) => r.id)
      .map((r) => ({ id: r.id!, snippet: r.snippet, historyId: r.historyId }));
  });
}

export async function searchGmailMessagesDb(
  tenantId: string,
  data: CorsairDbFilter,
  opts?: DbSearchOptions,
): Promise<
  Array<{
    id: string;
    threadId?: string;
    subject?: string;
    snippet?: string;
    from?: string;
    to?: string;
  }>
> {
  const corsair = withTenantDb(tenantId);
  const search = corsair?.gmail?.db?.messages?.search;
  if (!search) return [];

  return runSearch("gmail.db.messages.search", tenantId, async () => {
    const rows = (await search({
      data,
      limit: opts?.limit ?? 50,
      offset: opts?.offset ?? 0,
    })) as Array<{
      id?: string;
      threadId?: string;
      subject?: string;
      snippet?: string;
      from?: string;
      to?: string;
    }>;
    return rows
      .filter((r) => r.id)
      .map((r) => ({
        id: r.id!,
        threadId: r.threadId,
        subject: r.subject,
        snippet: r.snippet,
        from: r.from,
        to: r.to,
      }));
  });
}

export async function searchGmailDraftsDb(
  tenantId: string,
  data: CorsairDbFilter,
  opts?: DbSearchOptions,
): Promise<Array<{ id: string; messageId?: string }>> {
  const corsair = withTenantDb(tenantId);
  const search = corsair?.gmail?.db?.drafts?.search;
  if (!search) return [];

  return runSearch("gmail.db.drafts.search", tenantId, async () => {
    const rows = (await search({
      data,
      limit: opts?.limit ?? 50,
      offset: opts?.offset ?? 0,
    })) as Array<{ id?: string; messageId?: string }>;
    return rows.filter((r) => r.id).map((r) => ({ id: r.id!, messageId: r.messageId }));
  });
}

export async function searchGmailLabelsDb(
  tenantId: string,
  data: CorsairDbFilter,
  opts?: DbSearchOptions,
): Promise<Array<{ id: string; name?: string }>> {
  const corsair = withTenantDb(tenantId);
  const search = corsair?.gmail?.db?.labels?.search;
  if (!search) return [];

  return runSearch("gmail.db.labels.search", tenantId, async () => {
    const rows = (await search({
      data,
      limit: opts?.limit ?? 100,
      offset: opts?.offset ?? 0,
    })) as Array<{ id?: string; name?: string }>;
    return rows.filter((r) => r.id).map((r) => ({ id: r.id!, name: r.name }));
  });
}

export async function searchCalendarEventsDb(
  tenantId: string,
  data: CorsairDbFilter,
  opts?: DbSearchOptions,
): Promise<
  Array<{
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    hangoutLink?: string;
  }>
> {
  const corsair = withTenantDb(tenantId);
  const search = corsair?.googlecalendar?.db?.events?.search;
  if (!search) return [];

  return runSearch("googlecalendar.db.events.search", tenantId, async () => {
    const rows = (await search({
      data,
      limit: opts?.limit ?? 100,
      offset: opts?.offset ?? 0,
    })) as Array<{
      id?: string;
      summary?: string;
      description?: string;
      location?: string;
      hangoutLink?: string;
    }>;
    return rows
      .filter((r) => r.id)
      .map((r) => ({
        id: r.id!,
        summary: r.summary,
        description: r.description,
        location: r.location,
        start: (r as { start?: string }).start,
        end: (r as { end?: string }).end,
        hangoutLink: r.hangoutLink,
      }));
  });
}

export async function searchCalendarsDb(
  tenantId: string,
  data: CorsairDbFilter,
  opts?: DbSearchOptions,
): Promise<Array<{ id: string; summary?: string; timeZone?: string }>> {
  const corsair = withTenantDb(tenantId);
  const search = corsair?.googlecalendar?.db?.calendars?.search;
  if (!search) return [];

  return runSearch("googlecalendar.db.calendars.search", tenantId, async () => {
    const rows = (await search({
      data,
      limit: opts?.limit ?? 20,
      offset: opts?.offset ?? 0,
    })) as Array<{ id?: string; summary?: string; timeZone?: string }>;
    return rows
      .filter((r) => r.id)
      .map((r) => ({ id: r.id!, summary: r.summary, timeZone: r.timeZone }));
  });
}
