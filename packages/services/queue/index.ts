export type QueueItemKind =
  | "email_send"
  | "email_draft"
  | "calendar_invite"
  | "meeting_bundle"
  | "calendar_archive"
  | "calendar_delete";

export type QueueItemStatus = "pending" | "approved" | "dismissed" | "failed";

export type EmailQueuePayload = {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
};

export type CalendarQueuePayload = {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  attendeeEmails?: string[];
};

export type MeetingBundlePayload = {
  email: EmailQueuePayload;
  calendar: CalendarQueuePayload;
};

export type CalendarArchivePayload = {
  eventId: string;
  summary: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  htmlLink?: string;
};

export type CalendarDeletePayload = {
  eventId: string;
  summary: string;
  htmlLink?: string;
};

export type QueueItem = {
  id: string;
  kind: QueueItemKind;
  title: string;
  preview?: string;
  payload: Record<string, unknown>;
  sourceThreadId?: string;
  status: QueueItemStatus;
  errorMessage?: string;
  createdAt: string;
  resolvedAt?: string;
};

export interface QueueService {
  listItems(userId: string, opts?: { status?: QueueItemStatus | "pending" | "all" }): Promise<QueueItem[]>;
  pendingCount(userId: string): Promise<number>;
  enqueueEmail(
    userId: string,
    input: {
      mode: "send" | "draft";
      email: EmailQueuePayload;
      title?: string;
      preview?: string;
    },
  ): Promise<QueueItem>;
  enqueueCalendarInvite(
    userId: string,
    input: {
      calendar: CalendarQueuePayload;
      title?: string;
      preview?: string;
    },
  ): Promise<QueueItem>;
  enqueueMeetingBundle(
    userId: string,
    input: {
      bundle: MeetingBundlePayload;
      title?: string;
      preview?: string;
      sourceThreadId?: string;
    },
  ): Promise<QueueItem>;
  enqueueCalendarArchive(
    userId: string,
    input: {
      archive: CalendarArchivePayload;
      title?: string;
      preview?: string;
    },
  ): Promise<QueueItem>;
  enqueueCalendarDelete(
    userId: string,
    input: {
      delete: CalendarDeletePayload;
      title?: string;
      preview?: string;
    },
  ): Promise<QueueItem>;
  approve(
    userId: string,
    itemId: string,
    opts?: {
      archive?: { startDateTime: string; endDateTime: string; timeZone?: string };
    },
  ): Promise<QueueItem>;
  dismiss(userId: string, itemId: string): Promise<QueueItem>;
}

let queueService: QueueService | null = null;

export function registerQueueService(service: QueueService) {
  queueService = service;
}

export function getQueueService(): QueueService {
  if (!queueService) {
    throw new Error("Queue service is not registered");
  }
  return queueService;
}
