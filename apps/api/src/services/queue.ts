import { and, count, desc, eq } from "@repo/database";
import db from "@repo/database";
import { threadQueueItemsTable, type SelectQueueItem } from "@repo/database/schema";
import { logger } from "@repo/logger";
import { getCalendarService } from "@repo/services/calendar";
import { getInboxService } from "@repo/services/inbox";
import type {
  CalendarArchivePayload,
  CalendarQueuePayload,
  EmailQueuePayload,
  MeetingBundlePayload,
  QueueItem,
  QueueItemKind,
  QueueItemStatus,
  QueueService,
} from "@repo/services/queue";

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

function normalizeMeetingBundle(payload: Record<string, unknown>): MeetingBundlePayload {
  const email = payload.email as EmailQueuePayload | undefined;
  const calendarPayload = payload.calendar as CalendarQueuePayload | undefined;

  if (!email?.to || !email.subject || !email.body) {
    throw new Error("Meeting queue item is missing email details");
  }
  if (!calendarPayload?.summary || !calendarPayload.startDateTime || !calendarPayload.endDateTime) {
    throw new Error("Meeting queue item is missing calendar start or end time");
  }

  return { email, calendar: calendarPayload };
}

function truncate(value: string, max = 240) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export class ThreadQueueService implements QueueService {
  async listItems(userId: string, opts?: { status?: QueueItemStatus | "pending" | "all" }) {
    const status = opts?.status ?? "pending";
    const rows =
      status === "all"
        ? await db
            .select()
            .from(threadQueueItemsTable)
            .where(eq(threadQueueItemsTable.userId, userId))
            .orderBy(desc(threadQueueItemsTable.createdAt))
            .limit(50)
        : await db
            .select()
            .from(threadQueueItemsTable)
            .where(
              and(
                eq(threadQueueItemsTable.userId, userId),
                eq(threadQueueItemsTable.status, status === "pending" ? "pending" : status),
              ),
            )
            .orderBy(desc(threadQueueItemsTable.createdAt))
            .limit(50);

    return rows.map(mapRow);
  }

  async pendingCount(userId: string) {
    const [row] = await db
      .select({ value: count() })
      .from(threadQueueItemsTable)
      .where(
        and(eq(threadQueueItemsTable.userId, userId), eq(threadQueueItemsTable.status, "pending")),
      );
    return Number(row?.value ?? 0);
  }

  async enqueueEmail(
    userId: string,
    input: {
      mode: "send" | "draft";
      email: EmailQueuePayload;
      title?: string;
      preview?: string;
    },
  ) {
    const kind: QueueItemKind = input.mode === "draft" ? "email_draft" : "email_send";
    const title = input.title?.trim() || (kind === "email_draft" ? "Draft reply" : "Send reply");
    const preview = input.preview?.trim() || truncate(input.email.body);

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind,
        title,
        preview,
        payload: input.email,
        sourceThreadId: input.email.threadId,
        status: "pending",
      })
      .returning();

    if (!row) throw new Error("Could not queue email action");
    return mapRow(row);
  }

  async enqueueCalendarInvite(
    userId: string,
    input: {
      calendar: CalendarQueuePayload;
      title?: string;
      preview?: string;
    },
  ) {
    const title = input.title?.trim() || input.calendar.summary;
    const preview =
      input.preview?.trim() ||
      truncate(
        [input.calendar.description, input.calendar.attendeeEmails?.join(", ")]
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
        payload: input.calendar,
        status: "pending",
      })
      .returning();

    if (!row) throw new Error("Could not queue calendar invite");
    return mapRow(row);
  }

  async enqueueMeetingBundle(
    userId: string,
    input: {
      bundle: MeetingBundlePayload;
      title?: string;
      preview?: string;
      sourceThreadId?: string;
    },
  ) {
    const title = input.title?.trim() || `Meeting: ${input.bundle.calendar.summary}`;
    const preview =
      input.preview?.trim() ||
      truncate(
        `${input.bundle.calendar.summary} with ${input.bundle.email.to} — ${input.bundle.email.body}`,
      );

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind: "meeting_bundle",
        title,
        preview,
        payload: input.bundle,
        sourceThreadId: input.sourceThreadId ?? input.bundle.email.threadId,
        status: "pending",
      })
      .returning();

    if (!row) throw new Error("Could not queue meeting bundle");
    return mapRow(row);
  }

  async enqueueCalendarArchive(
    userId: string,
    input: {
      archive: CalendarArchivePayload;
      title?: string;
      preview?: string;
    },
  ) {
    const title = input.title?.trim() || `Archive: ${input.archive.summary}`;
    const preview =
      input.preview?.trim() ||
      truncate(`${input.archive.summary} · ${input.archive.startDateTime} → ${input.archive.endDateTime}`);

    const [row] = await db
      .insert(threadQueueItemsTable)
      .values({
        userId,
        kind: "calendar_archive",
        title,
        preview,
        payload: input.archive,
        status: "pending",
      })
      .returning();

    if (!row) throw new Error("Could not queue calendar archive");
    return mapRow(row);
  }

  async approve(
    userId: string,
    itemId: string,
    opts?: { archive?: { startDateTime: string; endDateTime: string; timeZone?: string } },
  ) {
    const [item] = await db
      .select()
      .from(threadQueueItemsTable)
      .where(and(eq(threadQueueItemsTable.id, itemId), eq(threadQueueItemsTable.userId, userId)));

    if (!item) throw new Error("Queue item not found");
    if (item.status !== "pending") throw new Error("Queue item is no longer pending");

    try {
      await this.executeItem(userId, item.kind, item.payload, opts);
      const [updated] = await db
        .update(threadQueueItemsTable)
        .set({ status: "approved", resolvedAt: new Date(), errorMessage: null })
        .where(eq(threadQueueItemsTable.id, itemId))
        .returning();
      if (!updated) throw new Error("Could not update queue item");
      return mapRow(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Queue approve failed", { itemId, userId, message });
      const [updated] = await db
        .update(threadQueueItemsTable)
        .set({ status: "failed", resolvedAt: new Date(), errorMessage: message })
        .where(eq(threadQueueItemsTable.id, itemId))
        .returning();
      if (!updated) throw new Error(message);
      throw new Error(message);
    }
  }

  async dismiss(userId: string, itemId: string) {
    const [updated] = await db
      .update(threadQueueItemsTable)
      .set({ status: "dismissed", resolvedAt: new Date(), errorMessage: null })
      .where(
        and(
          eq(threadQueueItemsTable.id, itemId),
          eq(threadQueueItemsTable.userId, userId),
          eq(threadQueueItemsTable.status, "pending"),
        ),
      )
      .returning();

    if (!updated) throw new Error("Queue item not found or already resolved");
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
        const email = payload as EmailQueuePayload;
        await inbox.sendMessage(userId, email);
        return;
      }
      case "email_draft": {
        const email = payload as EmailQueuePayload;
        await inbox.createDraft(userId, email);
        return;
      }
      case "calendar_invite": {
        const event = payload as CalendarQueuePayload;
        await calendar.createEvent(userId, event);
        return;
      }
      case "meeting_bundle": {
        const bundle = normalizeMeetingBundle(payload);
        await calendar.createEvent(userId, bundle.calendar);
        await inbox.sendMessage(userId, bundle.email);
        return;
      }
      case "calendar_archive": {
        const archive = payload as CalendarArchivePayload;
        const confirm = opts?.archive;
        if (confirm) {
          const datesChanged =
            confirm.startDateTime !== archive.startDateTime ||
            confirm.endDateTime !== archive.endDateTime;
          if (datesChanged) {
            await calendar.updateEventTimes(userId, archive.eventId, {
              startDateTime: confirm.startDateTime,
              endDateTime: confirm.endDateTime,
              timeZone: confirm.timeZone ?? archive.timeZone,
            });
          }
        }
        await calendar.cancelEvent(userId, archive.eventId);
        return;
      }
      default:
        throw new Error(`Unsupported queue item kind: ${String(kind)}`);
    }
  }
}
