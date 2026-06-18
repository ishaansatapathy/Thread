import { Router, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { processWebhook } from "corsair";

import { eq } from "@repo/database";
import db from "@repo/database";
import { usersTable } from "@repo/database/schema";
import { logger } from "@repo/logger";
import { trace, SpanStatusCode } from "@opentelemetry/api";

import { env } from "../env";
import { getCorsair, isCorsairConfigured } from "../corsair";
import { CorsairInboxService } from "../services/inbox";
import { CorsairCalendarService } from "../services/calendar";
import { mailCache } from "../services/mail-cache";
import { getLastHistoryId, setLastHistoryId } from "../services/gmail-state";
import { publishSyncEvent } from "../services/sync-events";
import { registerCorsairWebhookSync } from "../services/corsair-webhook-sync";

const inboxService = new CorsairInboxService();
const calendarService = new CorsairCalendarService();
const webhookTracer = trace.getTracer("thread-webhooks");

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

function isCalendarChannelAuthorized(req: Request): boolean {
  const secret = env.CORSAIR_WEBHOOK_SECRET;
  if (!secret) return isAuthorized(req);

  const token = req.header("x-goog-channel-token")?.trim();
  if (token) {
    const expected = Buffer.from(secret);
    const actual = Buffer.from(token);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      return true;
    }
  }

  return isAuthorized(req);
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

/** Parse tenant id embedded in our Calendar channel id (`thread-calendar-{uuid}-{ts}`). */
export function tenantFromCalendarChannel(req: Request): string | null {
  const channelId = req.header("x-goog-channel-id")?.trim();
  if (!channelId?.startsWith("thread-calendar-")) return null;
  const match = channelId.match(
    /^thread-calendar-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\d+$/i,
  );
  return match?.[1] ?? null;
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
  return webhookTracer.startActiveSpan("gmail.webhook.incremental", async (span) => {
    span.setAttribute("tenant.id", tenantId);
    try {
      const storedHistoryId = await getLastHistoryId(tenantId);

      if (storedHistoryId) {
        try {
          const corsair = getCorsair().withTenant(tenantId);
          const historyResp = await (corsair.gmail.api.users as {
            history?: {
              list: (opts: {
                startHistoryId: string;
                historyTypes?: string[];
              }) => Promise<{
                history?: Array<{
                  messagesAdded?: Array<{ message?: { threadId?: string } }>;
                  labelsAdded?: Array<{ message?: { threadId?: string } }>;
                  labelsRemoved?: Array<{ message?: { threadId?: string } }>;
                }>;
                historyId?: string;
              }>;
            };
          }).history?.list({
            startHistoryId: storedHistoryId,
            historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
          });

          if (historyResp) {
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
              await setLastHistoryId(tenantId, historyResp.historyId);
            } else if (incomingHistoryId) {
              await setLastHistoryId(tenantId, incomingHistoryId);
            }

            if (affectedThreadIds.size > 0) {
              logger.info("Gmail history sync: refreshing affected threads", {
                tenantId,
                count: affectedThreadIds.size,
              });
              for (const threadId of affectedThreadIds) {
                await mailCache.remove(tenantId, threadId);
              }
            }

            await refreshTenantInbox(tenantId);
            publishSyncEvent({ type: "inbox_updated", tenantId });
            span.setStatus({ code: SpanStatusCode.OK });
            return;
          }
        } catch (error) {
          logger.warn("Gmail history incremental sync failed, falling back to full refresh", {
            tenantId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (incomingHistoryId) {
        await setLastHistoryId(tenantId, incomingHistoryId);
      }
      await refreshTenantInbox(tenantId);
      publishSyncEvent({ type: "inbox_updated", tenantId });
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Warms the local mail cache for a tenant. Runs detached so we can ACK the push
 * immediately — Google/Corsair retry aggressively on slow responses.
 */
async function refreshTenantInbox(tenantId: string) {
  await inboxService.listThreads(tenantId, { maxResults: 50 }).catch((error: unknown) => {
    logger.warn("Webhook inbox refresh failed", {
      tenantId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

async function refreshTenantCalendar(tenantId: string) {
  const now = new Date();
  const monthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  try {
    await calendarService.listEvents(tenantId, {
      timeMin: now.toISOString(),
      timeMax: monthAhead.toISOString(),
      maxResults: 100,
    });
    publishSyncEvent({ type: "calendar_updated", tenantId });
  } catch (error: unknown) {
    logger.warn("Webhook calendar refresh failed", {
      tenantId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runCorsairProcessWebhook(
  req: Request,
  tenantId: string | null,
): Promise<void> {
  if (!isCorsairConfigured()) return;

  const corsair = getCorsair();
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value) && value[0]) headers[key] = value[0];
  }

  try {
    await processWebhook(
      corsair,
      headers,
      req.body,
      tenantId ? { tenantId } : undefined,
    );
  } catch (error) {
    logger.warn("processWebhook failed", {
      tenantId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
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

  void runCorsairProcessWebhook(req, tenantId);

  if (tenantId) {
    void refreshTenantInboxIncremental(tenantId, incomingHistoryId);
  } else {
    logger.warn("Gmail webhook received without a resolvable tenant");
  }

  return res.status(200).json({ ok: true });
});

webhooksRouter.post("/calendar", async (req, res) => {
  if (!isCalendarChannelAuthorized(req)) {
    return res.status(env.CORSAIR_WEBHOOK_SECRET ? 401 : 503).json({
      ok: false,
      error: env.CORSAIR_WEBHOOK_SECRET
        ? "Invalid webhook secret"
        : "Webhooks are not configured (set CORSAIR_WEBHOOK_SECRET)",
    });
  }

  const tenantId = tenantFromCalendarChannel(req) ?? (await resolveTenantId(req.body));
  void runCorsairProcessWebhook(req, tenantId);

  if (tenantId) {
    void refreshTenantCalendar(tenantId);
  } else {
    logger.warn("Calendar webhook received without a resolvable tenant", {
      channelId: req.header("x-goog-channel-id"),
    });
  }

  return res.status(200).json({ ok: true });
});

registerCorsairWebhookSync({
  onGmailMessageChanged: (tenantId) => {
    void refreshTenantInboxIncremental(tenantId);
  },
  onCalendarEventChanged: (tenantId) => {
    void refreshTenantCalendar(tenantId);
  },
});

/**
 * Unified Corsair webhook entry — dispatches to plugin webhook handlers via
 * processWebhook and fires webhookHooks (sync refresh). Legacy /gmail and
 * /calendar routes remain for backward compatibility.
 */
webhooksRouter.post("/corsair", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(env.CORSAIR_WEBHOOK_SECRET ? 401 : 503).json({
      ok: false,
      error: env.CORSAIR_WEBHOOK_SECRET
        ? "Invalid webhook secret"
        : "Webhooks are not configured (set CORSAIR_WEBHOOK_SECRET)",
    });
  }

  if (!isCorsairConfigured()) {
    return res.status(503).json({ ok: false, error: "Corsair is not configured" });
  }

  const pubsub = decodePubSubData(req.body);
  const tenantId =
    tenantFromCalendarChannel(req) ??
    (await resolveTenantId(req.body)) ??
    (typeof req.query.tenantId === "string" ? req.query.tenantId.trim() : null);

  await runCorsairProcessWebhook(req, tenantId);

  if (tenantId && pubsub?.historyId) {
    await setLastHistoryId(tenantId, pubsub.historyId);
  }

  if (tenantId) {
    void refreshTenantInboxIncremental(tenantId, pubsub?.historyId?.trim());
  }

  return res.status(200).json({ ok: true });
});
