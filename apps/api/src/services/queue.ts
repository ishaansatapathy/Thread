import { and, count, desc, eq, inArray, lt } from "@repo/database";
import db from "@repo/database";
import { threadQueueItemsTable, usersTable, type SelectQueueItem } from "@repo/database/schema";
import { logger } from "@repo/logger";
import { getCalendarService } from "@repo/services/calendar";
import { ServiceError, serviceError } from "@repo/services/errors";
import { getInboxService } from "@repo/services/inbox";
import {
  parseCalendarArchivePayload,
  parseCalendarDeletePayload,
  parseCalendarQueuePayload,
  parseDraftSendPayload,
  parseEmailQueuePayload,
  parseMeetingBundlePayload,
} from "@repo/services/queue/schemas";
import { parseQuickAddText } from "./parse-quick-add";
import type {
  CalendarArchivePayload,
  CalendarDeletePayload,
  CalendarQueuePayload,
  EmailQueuePayload,
  MeetingBundlePayload,
  QueueEnqueueOptions,
  QueueEnqueueOrigin,
  QueueItem,
  QueueItemKind,
  QueueItemStatus,
  QueueService,
} from "@repo/services/queue";
import { incrementCounter } from "../metrics";

function mapRow(row: SelectQueueItem): QueueItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    preview: row.preview ?? undefined,
    payload: row.payload,
    sourceThreadId: row.sourceThreadId ?? undefined,
    status: row.status,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
  };
}

function truncate(value: string, max = 240) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function emailQueueFingerprint(kind: QueueItemKind, email: EmailQueuePayload): string {
  return `${kind}:${email.to.trim().toLowerCase()}|${email.subject.trim()}|${email.body.trim()}`;
}

const DUPLICATE_QUEUE_WINDOW_MS = 10 * 60 * 1000;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const ACTIVE_QUEUE_STATUSES = ["pending", "processing", "approved"] as const;

function userFacingApproveError(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  return "Could not complete this action. Check your connections and try again.";
}

type ApprovalPrefs = {
  autoApproveEmail: boolean;
  autoApproveAgentEmail: boolean;
  autoApproveCalendar: boolean;
};

async function loadApprovalPrefs(userId: string): Promise<ApprovalPrefs> {
  const [user] = await db
    .select({
      autoApproveEmail: usersTable.autoApproveEmail,
      autoApproveAgentEmail: usersTable.autoApproveAgentEmail,
      autoApproveCalendar: usersTable.autoApproveCalendar,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  return {
    autoApproveEmail: user?.autoApproveEmail ?? false,
    autoApproveAgentEmail: user?.autoApproveAgentEmail ?? false,
    autoApproveCalendar: user?.autoApproveCalendar ?? false,
  };
}

function wantsAutoApprove(
  kind: QueueItemKind,
  origin: QueueEnqueueOrigin | undefined,
  prefs: ApprovalPrefs,
): boolean {
  switch (kind) {
    case "email_send":
    case "email_draft":
    case "draft_send":
      return origin === "agent" ? prefs.autoApproveAgentEmail : prefs.autoApproveEmail;
    case "calendar_invite":
    case "calendar_archive":
    case "calendar_delete":
    case "meeting_bundle":
      return prefs.autoApproveCalendar;
    default:
      return false;
  }
}

export class ThreadQueueService implements QueueService {
  private async findRecentDuplicateEmailItem(
    userId: string,
    kind: QueueItemKind,
    email: EmailQueuePayload,
  ): Promise<SelectQueueItem | undefined> {
    const fingerprint = emailQueueFingerprint(kind, email);
    const since = new Date(Date.now() - DUPLICATE_QUEUE_WINDOW_MS);
    const rows = await db
      .select()
      .from(threadQueueItemsTable)
      .where(
        and(
          eq(threadQueueItemsTable.userId, userId),
          eq(threadQueueItemsTable.kind, kind),
        ),
      )
      .orderBy(desc(threadQueueItemsTable.createdAt))
      .limit(20);

    return rows.find((row) => {
      if (!row.createdAt || row.createdAt < since) return false;
      if (!ACTIVE_QUEUE_STATUSES.includes(row.status as (typeof ACTIVE_QUEUE_STATUSES)[number])) {
        return false;
      }
      try {
        return emailQueueFingerprint(row.kind, parseEmailQueuePayload(row.payload)) === fingerprint;
      } catch {
        return false;
      }
    });
  }

  private async maybeAutoApprove(
    userId: string,
    item: QueueItem,
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem> {
    const prefs = await loadApprovalPrefs(userId);
    if (!wantsAutoApprove(item.kind, opts?.origin, prefs)) {
      return item;
    }

    try {
      return await this.approve(userId, item.id);
    } catch (error) {
      logger.warn("Auto-approve failed; item left pending in queue", {
        userId,
        itemId: item.id,
        kind: item.kind,
        message: error instanceof Error ? error.message : String(error),
      });
      return item;
    }
  }

  private async recoverStaleProcessing(userId: string) {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
    await db
      .update(threadQueueItemsTable)
      .set({ status: "pending", processingAt: null })
      .where(
        and(
          eq(threadQueueItemsTable.userId, userId),
          eq(threadQueueItemsTable.status, "processing"),
          lt(threadQueueItemsTable.processingAt, cutoff),
        ),
      );
  }

  async listItems(userId: string, opts?: { status?: QueueItemStatus | "pending" | "all"; limit?: number }) {
    await this.recoverStaleProcessing(userId);
    const status = opts?.status ?? "pending";
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
    const rows =
      status === "all"
        ? await db
            .select()
            .from(threadQueueItemsTable)
            .where(eq(threadQueueItemsTable.userId, userId))
            .orderBy(desc(threadQueueItemsTable.createdAt))
            .limit(limit)
        : status === "pending"
          ? await db
              .select()
              .from(threadQueueItemsTable)
              .where(
                and(
                  eq(threadQueueItemsTable.userId, userId),
                  inArray(threadQueueItemsTable.status, ["pending", "processing"]),
                ),
              )
              .orderBy(desc(threadQueueItemsTable.createdAt))
              .limit(limit)
          : await db
              .select()
              .from(threadQueueItemsTable)
              .where(
                and(eq(threadQueueItemsTable.userId, userId), eq(threadQueueItemsTable.status, status)),
              )
              .orderBy(desc(threadQueueItemsTable.createdAt))
              .limit(limit);

    return rows.map(mapRow);
  }

  async pendingCount(userId: string) {
    await this.recoverStaleProcessing(userId);
    const [row] = await db
      .select({ value: count() })
      .from(threadQueueItemsTable)
      .where(
        and(
          eq(threadQueueItemsTable.userId, userId),
          inArray(threadQueueItemsTable.status, ["pending", "processing"]),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async getStats(userId: string) {
    const rows = await db
      .select()
      .from(threadQueueItemsTable)
      .where(eq(threadQueueItemsTable.userId, userId))
      .orderBy(desc(threadQueueItemsTable.createdAt))
      .limit(500);

    const total = rows.length;
    const pending = rows.filter((r) => r.status === "pending" || r.status === "processing").length;
    const approved = rows.filter((r) => r.status === "approved").length;
    const dismissed = rows.filter((r) => r.status === "dismissed").length;
    const failed = rows.filter((r) => r.status === "failed").length;

    // Action type breakdown
    const byKind: Record<string, number> = {};
    for (const row of rows) {
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    }

    // Last 14 days activity — bucket by date
    const now = Date.now();
    const DAY_MS = 86_400_000;
    const days: { date: string; queued: number; approved: number; dismissed: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(now - i * DAY_MS);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      const label = dayStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dayRows = rows.filter((r) => {
        const t = r.createdAt?.getTime() ?? 0;
        return t >= dayStart.getTime() && t < dayEnd.getTime();
      });
      days.push({
        date: label,
        queued: dayRows.length,
        approved: dayRows.filter((r) => r.status === "approved").length,
        dismissed: dayRows.filter((r) => r.status === "dismissed").length,
      });
    }

    return { total, pending, approved, dismissed, failed, byKind, timeline: days };
  }

  async enqueueEmail(
    userId: string,
    input: {
      mode: "send" | "draft";
      email: EmailQueuePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ) {
    const kind: QueueItemKind = input.mode === "draft" ? "email_draft" : "email_send";
    const title = input.title?.trim() || (kind === "email_draft" ? "Draft reply" : "Send reply");
    const preview = input.preview?.trim() || truncate(input.email.body);
    const email = parseEmailQueuePayload(input.email);

    const duplicate = await this.findRecentDuplicateEmailItem(userId, kind, email);
    if (duplicate) {
      logger.warn("Duplicate email queue enqueue skipped", {
        userId,
        kind,
        existingId: duplicate.id,
        status: duplicate.status,
      });
      return mapRow(duplicate);
    }

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind,
        title,
        preview,
        payload: email,
        sourceThreadId: email.threadId,
        status: "pending",
      })
      .returning();

    if (!row) throw serviceError("INTERNAL", "Could not queue email action");
    return this.maybeAutoApprove(userId, mapRow(row), opts);
  }

  async enqueueCalendarInvite(
    userId: string,
    input: {
      calendar: CalendarQueuePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ) {
    const calendar = parseCalendarQueuePayload(input.calendar);
    const title = input.title?.trim() || calendar.summary;
    const preview =
      input.preview?.trim() ||
      truncate(
        [calendar.description, calendar.attendeeEmails?.join(", ")]
          .filter(Boolean)
          .join(" · "),
      );

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind: "calendar_invite",
        title,
        preview,
        payload: calendar,
        status: "pending",
      })
      .returning();

    if (!row) throw serviceError("INTERNAL", "Could not queue calendar invite");
    return this.maybeAutoApprove(userId, mapRow(row), { origin: opts?.origin ?? "calendar" });
  }

  async enqueueMeetingBundle(
    userId: string,
    input: {
      bundle: MeetingBundlePayload;
      title?: string;
      preview?: string;
      sourceThreadId?: string;
    },
    opts?: QueueEnqueueOptions,
  ) {
    const bundle = parseMeetingBundlePayload(input.bundle);
    const title = input.title?.trim() || `Meeting: ${bundle.calendar.summary}`;
    const preview =
      input.preview?.trim() ||
      truncate(
        `${bundle.calendar.summary} with ${bundle.email.to} — ${bundle.email.body}`,
      );

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind: "meeting_bundle",
        title,
        preview,
        payload: bundle,
        sourceThreadId: input.sourceThreadId ?? bundle.email.threadId,
        status: "pending",
      })
      .returning();

    if (!row) throw serviceError("INTERNAL", "Could not queue meeting bundle");
    return this.maybeAutoApprove(userId, mapRow(row), { origin: opts?.origin ?? "calendar" });
  }

  async enqueueCalendarArchive(
    userId: string,
    input: {
      archive: CalendarArchivePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ) {
    const archive = parseCalendarArchivePayload(input.archive);
    const title = input.title?.trim() || `Reschedule: ${archive.summary}`;
    const preview =
      input.preview?.trim() ||
      truncate(
        `${archive.summary} · ${archive.startDateTime} → ${archive.endDateTime}`,
      );

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind: "calendar_archive",
        title,
        preview,
        payload: archive,
        status: "pending",
      })
      .returning();

    if (!row) throw serviceError("INTERNAL", "Could not queue calendar archive");
    return this.maybeAutoApprove(userId, mapRow(row), { origin: opts?.origin ?? "calendar" });
  }

  async enqueueCalendarDelete(
    userId: string,
    input: {
      delete: CalendarDeletePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ) {
    const payload = parseCalendarDeletePayload(input.delete);

    const existingRows = await db
      .select()
      .from(threadQueueItemsTable)
      .where(
        and(
          eq(threadQueueItemsTable.userId, userId),
          eq(threadQueueItemsTable.kind, "calendar_delete"),
          inArray(threadQueueItemsTable.status, ["pending", "processing"]),
        ),
      )
      .orderBy(desc(threadQueueItemsTable.createdAt))
      .limit(20);

    const duplicate = existingRows.find((row) => {
      try {
        return parseCalendarDeletePayload(row.payload).eventId === payload.eventId;
      } catch {
        return false;
      }
    });

    if (duplicate) {
      return mapRow(duplicate);
    }

    const title = input.title?.trim() || `Delete: ${payload.summary}`;
    const preview = input.preview?.trim() || truncate(payload.summary);

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind: "calendar_delete",
        title,
        preview,
        payload,
        status: "pending",
      })
      .returning();

    if (!row) throw serviceError("INTERNAL", "Could not queue calendar delete");
    return this.maybeAutoApprove(userId, mapRow(row), { origin: opts?.origin ?? "calendar" });
  }

  async enqueueQuickAddCalendar(
    userId: string,
    input: { text: string; title?: string; preview?: string },
    opts?: QueueEnqueueOptions,
  ) {
    const text = input.text.trim();
    if (!text) throw serviceError("BAD_REQUEST", "text is required");

    const parsed = parseQuickAddText(text);
    return this.enqueueCalendarInvite(
      userId,
      {
        calendar: {
          summary: parsed.summary,
          startDateTime: parsed.startDateTime,
          endDateTime: parsed.endDateTime,
          timeZone: parsed.timeZone,
          allDay: parsed.allDay,
        },
        title: input.title?.trim() || `Calendar: ${parsed.summary}`,
        preview: input.preview?.trim() || truncate(text),
      },
      { origin: opts?.origin ?? "calendar" },
    );
  }

  async enqueueDraftSend(
    userId: string,
    input: { draftId: string; title?: string; preview?: string },
    opts?: QueueEnqueueOptions,
  ) {
    const draftId = input.draftId.trim();
    if (!draftId) throw serviceError("BAD_REQUEST", "draftId is required");

    const payload = parseDraftSendPayload({ draftId });
    const title = input.title?.trim() || "Send draft";
    const preview = input.preview?.trim() || `Draft ${draftId}`;

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind: "draft_send",
        title,
        preview,
        payload,
        status: "pending",
      })
      .returning();

    if (!row) throw serviceError("INTERNAL", "Could not queue draft send");
    return this.maybeAutoApprove(userId, mapRow(row), { origin: opts?.origin ?? "inbox" });
  }

  async approve(
    userId: string,
    itemId: string,
    opts?: { archive?: { startDateTime: string; endDateTime: string; timeZone?: string } },
  ) {
    const [claimed] = await db
      .update(threadQueueItemsTable)
      .set({ status: "processing", processingAt: new Date(), errorMessage: null, resolvedAt: null })
      .where(
        and(
          eq(threadQueueItemsTable.id, itemId),
          eq(threadQueueItemsTable.userId, userId),
          eq(threadQueueItemsTable.status, "pending"),
        ),
      )
      .returning();

    if (!claimed) {
      throw serviceError("NOT_FOUND", "Queue item not found or already resolved");
    }

    try {
      await this.executeItem(userId, claimed.kind, claimed.payload, opts);

      const [approved] = await db
        .update(threadQueueItemsTable)
        .set({ status: "approved", resolvedAt: new Date(), processingAt: null, errorMessage: null })
        .where(
          and(
            eq(threadQueueItemsTable.id, itemId),
            eq(threadQueueItemsTable.userId, userId),
            eq(threadQueueItemsTable.status, "processing"),
          ),
        )
        .returning();

      if (!approved) {
        throw serviceError("INTERNAL", "Queue item state changed during approval");
      }

      incrementCounter(`queue.approved.${claimed.kind}`);
      incrementCounter("queue.approved.total");
      return mapRow(approved);
    } catch (error) {
      const userMessage = userFacingApproveError(error);
      logger.error("Queue approve failed", {
        itemId,
        userId,
        kind: claimed.kind,
        message: error instanceof Error ? error.message : String(error),
      });

      await db
        .update(threadQueueItemsTable)
        .set({
          status: "failed",
          resolvedAt: new Date(),
          processingAt: null,
          errorMessage: userMessage,
        })
        .where(
          and(
            eq(threadQueueItemsTable.id, itemId),
            eq(threadQueueItemsTable.userId, userId),
            eq(threadQueueItemsTable.status, "processing"),
          ),
        );

      throw serviceError("PRECONDITION_FAILED", userMessage);
    }
  }

  async dismiss(userId: string, itemId: string) {
    const [updated] = await db
      .update(threadQueueItemsTable)
      .set({ status: "dismissed", resolvedAt: new Date(), errorMessage: null, processingAt: null })
      .where(
        and(
          eq(threadQueueItemsTable.id, itemId),
          eq(threadQueueItemsTable.userId, userId),
          inArray(threadQueueItemsTable.status, ["pending", "processing"]),
        ),
      )
      .returning();

    if (!updated) {
      throw serviceError("NOT_FOUND", "Queue item not found or already resolved");
    }
    incrementCounter("queue.dismissed.total");
    return mapRow(updated);
  }

  private async executeItem(
    userId: string,
    kind: QueueItemKind,
    payload: Record<string, unknown>,
    opts?: { archive?: { startDateTime: string; endDateTime: string; timeZone?: string } },
  ) {
    const inbox = getInboxService();
    const calendar = getCalendarService();

    switch (kind) {
      case "email_send": {
        const email = parseEmailQueuePayload(payload);
        await inbox.sendMessage(userId, email);
        return;
      }
      case "email_draft": {
        const email = parseEmailQueuePayload(payload);
        await inbox.createDraft(userId, email);
        return;
      }
      case "draft_send": {
        const draft = parseDraftSendPayload(payload);
        await inbox.sendDraft(userId, draft.draftId);
        return;
      }
      case "calendar_invite": {
        const event = parseCalendarQueuePayload(payload);
        await calendar.createEvent(userId, event);
        return;
      }
      case "meeting_bundle": {
        const bundle = parseMeetingBundlePayload(payload);
        let createdEventId: string | undefined;

        try {
          const created = await calendar.createEvent(userId, bundle.calendar);
          createdEventId = created.id;
          await inbox.sendMessage(userId, bundle.email);
        } catch (error) {
          if (createdEventId) {
            throw serviceError(
              "PRECONDITION_FAILED",
              `Calendar event was created but the email could not be sent. Check Google Calendar (event ${createdEventId}) and retry if needed.`,
            );
          }
          throw error;
        }
        return;
      }
      case "calendar_archive": {
        const archive = parseCalendarArchivePayload(payload);
        const target = opts?.archive ?? {
          startDateTime: archive.startDateTime,
          endDateTime: archive.endDateTime,
          timeZone: archive.timeZone,
        };
        await calendar.updateEventTimes(userId, archive.eventId, {
          startDateTime: target.startDateTime,
          endDateTime: target.endDateTime,
          timeZone: target.timeZone ?? archive.timeZone,
          allDay: archive.allDay,
        }, {
          editScope: archive.editScope,
          recurringEventId: archive.recurringEventId,
        });
        return;
      }
      case "calendar_delete": {
        const deletePayload = parseCalendarDeletePayload(payload);
        if (deletePayload.cancelWithNotify) {
          await calendar.cancelEvent(userId, deletePayload.eventId);
        } else {
          await calendar.deleteEvent(userId, deletePayload.eventId, {
            editScope: deletePayload.editScope,
            recurringEventId: deletePayload.recurringEventId,
          });
        }
        return;
      }
      default:
        throw serviceError("INTERNAL", `Unsupported queue item kind: ${String(kind)}`);
    }
  }
}
