import { timingSafeEqual } from "node:crypto";

import { Router, type Request } from "express";
import { eq } from "@repo/database";
import db from "@repo/database";
import { usersTable } from "@repo/database/schema";
import { logger } from "@repo/logger";

import { env } from "../env";
import { CorsairInboxService } from "../services/inbox";
import { CorsairCalendarService } from "../services/calendar";
import { getCorsair } from "../corsair";
import { mailCache } from "../services/mail-cache";

const inboxService = new CorsairInboxService();
const calendarService = new CorsairCalendarService();

// ── Per-user Gmail historyId cache (in-process) ─────────────────────────────
// We store the latest historyId per user so we can use the History API for
// incremental sync instead of re-fetching the full thread list on every push.
const lastHistoryIdByUser = new Map<string, string>();

export function setLastHistoryId(userId: string, historyId: string) {
  lastHistoryIdByUser.set(userId, historyId);
}

export function getLastHistoryId(userId: string): string | undefined {
  return lastHistoryIdByUser.get(userId);
}

export const webhooksRouter = Router();

/** Constant-time secret check; tolerates length differences without leaking via timing. */
function isAuthorized(req: Request): boolean {
  const secret = env.CORSAIR_WEBHOOK_SECRET;
  if (!secret) return false;

  const provided =
    (req.header("x-corsair-webhook-secret") ??
      req.header("x-webhook-secret") ??
      "").trim();
  if (!provided) return false;

  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Decodes a Google Pub/Sub push envelope. Push messages carry the payload as a
 * base64-encoded JSON string in `message.data`.
 */
export function decodePubSubData(body: unknown): { emailAddress?: string; historyId?: string } | null {
  if (!body || typeof body !== "object") return null;
  const message = (body as { message?: { data?: string } }).message;
  if (!message?.data) return null;
  try {
    const json = Buffer.from(message.data, "base64").toString("utf8");
    return JSON.parse(json) as { emailAddress?: string; historyId?: string };
  } catch {
    return null;
  }
}

async function resolveTenantId(body: unknown): Promise<string | null> {
  if (body && typeof body === "object") {
    const explicit = (body as { tenantId?: unknown }).tenantId;
    if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  }

  const pubsub = decodePubSubData(body);
  const email = pubsub?.emailAddress?.trim().toLowerCase();
  if (!email) return null;

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  return user?.id ?? null;
}

/**
 * Uses Gmail History API for incremental sync when a stored historyId is
 * available. Falls back to a full list if history is too stale or missing.
 */
async function refreshTenantInboxIncremental(tenantId: string, incomingHistoryId?: string) {
  const storedHistoryId = getLastHistoryId(tenantId);

  if (storedHistoryId) {
    // Try incremental sync first.
    try {
      const corsair = getCorsair().withTenant(tenantId);
      const historyResp = await (corsair.gmail.api.users as {
        history?: { list: (opts: { startHistoryId: string; historyTypes?: string[] }) => Promise<{ history?: Array<{ messagesAdded?: Array<{ message?: { threadId?: string; historyId?: string } }>; labelsAdded?: Array<{ message?: { threadId?: string } }>; labelsRemoved?: Array<{ message?: { threadId?: string } }> }>; historyId?: string }> };
      }).history?.list({ startHistoryId: storedHistoryId, historyTypes: ["messageAdded", "labelAdded", "labelRemoved"] });

      if (historyResp) {
        // Collect the affected threadIds from history records.
        const affectedThreadIds = new Set<string>();
        for (const record of historyResp.history ?? []) {
          for (const added of record.messagesAdded ?? []) {
            if (added.message?.threadId) affectedThreadIds.add(added.message.threadId);
          }
          for (const la of record.labelsAdded ?? []) {
            if (la.message?.threadId) affectedThreadIds.add(la.message.threadId);
          }
          for (const lr of record.labelsRemoved ?? []) {
            if (lr.message?.threadId) affectedThreadIds.add(lr.message.threadId);
          }
        }

        if (historyResp.historyId) {
          setLastHistoryId(tenantId, historyResp.historyId);
        } else if (incomingHistoryId) {
          setLastHistoryId(tenantId, incomingHistoryId);
        }

        if (affectedThreadIds.size > 0) {
          logger.info("Gmail history sync: refreshing affected threads", {
            tenantId,
            count: affectedThreadIds.size,
          });
          // Invalidate + re-fetch just the affected threads from the cache
          // so the full inbox list doesn't need to be re-fetched.
          for (const threadId of affectedThreadIds) {
            await mailCache.remove(tenantId, threadId);
          }
        }
        // After incremental, refresh list to pick up latest metadata.
        refreshTenantInbox(tenantId);
        return;
      }
    } catch (error) {
      logger.warn("Gmail history incremental sync failed, falling back to full refresh", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // First webhook or history too stale — do a full refresh and store historyId.
  if (incomingHistoryId) {
    setLastHistoryId(tenantId, incomingHistoryId);
  }
  refreshTenantInbox(tenantId);
}

/**
 * Warms the local mail cache for a tenant. Runs detached so we can ACK the push
 * immediately — Google/Corsair retry aggressively on slow responses.
 */
function refreshTenantInbox(tenantId: string) {
  void inboxService
    .listThreads(tenantId, { maxResults: 50 })
    .catch((error: unknown) => {
      logger.warn("Webhook inbox refresh failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
}

function refreshTenantCalendar(tenantId: string) {
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  void calendarService
    .listEvents(tenantId, {
      timeMin: now.toISOString(),
      timeMax: weekAhead.toISOString(),
      maxResults: 100,
    })
    .catch((error: unknown) => {
      logger.warn("Webhook calendar refresh failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
}

webhooksRouter.post("/gmail", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(env.CORSAIR_WEBHOOK_SECRET ? 401 : 503).json({
      ok: false,
      error: env.CORSAIR_WEBHOOK_SECRET
        ? "Invalid webhook secret"
        : "Webhooks are not configured (set CORSAIR_WEBHOOK_SECRET)",
    });
  }

  const tenantId = await resolveTenantId(req.body);
  const pubsub = decodePubSubData(req.body);
  const incomingHistoryId = pubsub?.historyId?.trim();

  if (tenantId) {
    void refreshTenantInboxIncremental(tenantId, incomingHistoryId);
  } else {
    logger.warn("Gmail webhook received without a resolvable tenant");
  }

  // Always ACK 200 so the push subscription is not retried into a backlog.
  return res.status(200).json({ ok: true });
});

webhooksRouter.post("/calendar", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(env.CORSAIR_WEBHOOK_SECRET ? 401 : 503).json({
      ok: false,
      error: env.CORSAIR_WEBHOOK_SECRET
        ? "Invalid webhook secret"
        : "Webhooks are not configured (set CORSAIR_WEBHOOK_SECRET)",
    });
  }

  const tenantId = await resolveTenantId(req.body);
  if (tenantId) {
    refreshTenantCalendar(tenantId);
  } else {
    logger.warn("Calendar webhook received without a resolvable tenant");
  }

  return res.status(200).json({ ok: true });
});
