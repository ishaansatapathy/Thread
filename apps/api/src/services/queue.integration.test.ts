import { eq } from "@repo/database";
import db from "@repo/database";
import { threadQueueItemsTable, usersTable } from "@repo/database/schema";
import { registerCalendarService } from "@repo/services/calendar";
import { ServiceError } from "@repo/services/errors";
import { registerInboxService, type InboxService } from "@repo/services/inbox";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

import { ThreadQueueService } from "./queue";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

describe.skipIf(!hasDatabase)("ThreadQueueService integration", () => {
  const sendMessage = vi.fn(async () => ({ id: "msg-1", threadId: "thread-1" }));
  const createDraft = vi.fn(async () => ({ id: "draft-1" }));
  const createEvent = vi.fn(async () => ({
    id: "event-1",
    summary: "Test event",
    start: "2026-06-15T10:00:00Z",
    end: "2026-06-15T11:00:00Z",
  }));

  let userId: string;
  let queue: ThreadQueueService;

  beforeAll(async () => {
    queue = new ThreadQueueService();

    const [user] = await db
      .insert(usersTable)
      .values({
        fullName: "Queue Test User",
        email: `queue-test-${Date.now()}@thread.dev`,
        emailVerified: true,
        authProvider: "local",
      })
      .returning();

    if (!user) throw new Error("Could not create test user");
    userId = user.id;

    const inboxStub: InboxService = {
      isConfigured: () => true,
      getConnectionStatus: async () => ({ gmail: "connected" }),
      listThreads: async () => ({ threads: [] }),
      listCachedThreads: async () => ({ threads: [] }),
      listDrafts: async () => ({ drafts: [] }),
      getDraft: async () => null,
      getThread: async () => null,
      sendMessage,
      createDraft,
      markThreadRead: vi.fn(async () => undefined),
      markThreadUnread: vi.fn(async () => undefined),
      archiveThread: vi.fn(async () => undefined),
      ensureLabel: vi.fn(async () => "label-id"),
      autoLabelThreads: vi.fn(async () => undefined),
      listLabels: vi.fn(async () => []),
      applyLabel: vi.fn(async () => undefined),
      removeLabel: vi.fn(async () => undefined),
      starThread: vi.fn(async () => undefined),
      unstarThread: vi.fn(async () => undefined),
      markImportant: vi.fn(async () => undefined),
      markNotImportant: vi.fn(async () => undefined),
      trashThread: vi.fn(async () => undefined),
      deleteDraft: vi.fn(async () => undefined),
      registerGmailWatch: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    };

    registerInboxService(inboxStub);
    registerCalendarService({
      isConfigured: () => true,
      getConnectionStatus: async () => ({ googlecalendar: "connected" }),
      getEvent: async () => null,
      listEvents: async () => ({ events: [] }),
      createEvent,
      cancelEvent: async () => ({ success: true as const }),
      updateEventTimes: async () => ({
        id: "event-1",
        summary: "Updated",
        start: "2026-06-15T10:00:00Z",
        end: "2026-06-15T11:00:00Z",
      }),
      deleteEvent: async () => ({ success: true as const }),
      checkFreeBusy: async () => ({ conflicts: [] }),
      respondToEvent: vi.fn(async () => ({
        id: "event-1",
        summary: "Meeting",
        start: "2026-06-15T10:00:00Z",
        end: "2026-06-15T11:00:00Z",
      })),
      disconnect: vi.fn(async () => undefined),
      patchEventDetails: vi.fn(async () => null),
      quickAddEvent: vi.fn(async () => ({ id: "event-1", summary: "Quick event" })),
      registerWebhook: vi.fn(async () => undefined),
    });
  });

  afterAll(async () => {
    if (!userId) return;
    await db.delete(threadQueueItemsTable).where(eq(threadQueueItemsTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("approves a pending email exactly once", async () => {
    sendMessage.mockClear();

    const item = await queue.enqueueEmail(userId, {
      mode: "send",
      email: {
        to: "guest@company.com",
        subject: "Integration test",
        body: "Hello from Thread queue test.",
      },
    });

    expect(item.status).toBe("pending");

    const approved = await queue.approve(userId, item.id);
    expect(approved.status).toBe("approved");
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await expect(queue.approve(userId, item.id)).rejects.toBeInstanceOf(ServiceError);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate email enqueue within the dedupe window", async () => {
    sendMessage.mockClear();

    const payload = {
      mode: "send" as const,
      email: {
        to: "guest@company.com",
        subject: "Duplicate test",
        body: "Same body.",
      },
    };

    const first = await queue.enqueueEmail(userId, payload);
    const second = await queue.enqueueEmail(userId, payload);

    expect(second.id).toBe(first.id);
  });

  it("dismisses a pending item without executing side effects", async () => {
    sendMessage.mockClear();

    const item = await queue.enqueueEmail(userId, {
      mode: "send",
      email: {
        to: "guest@company.com",
        subject: "Dismiss test",
        body: "Should not send.",
      },
    });

    const dismissed = await queue.dismiss(userId, item.id);
    expect(dismissed.status).toBe("dismissed");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("marks failed when execution throws after claim", async () => {
    sendMessage.mockClear();
    sendMessage.mockRejectedValueOnce(new Error("Gmail unavailable"));

    const item = await queue.enqueueEmail(userId, {
      mode: "send",
      email: {
        to: "fail@company.com",
        subject: "Failure test",
        body: "Should not stay approved.",
      },
    });

    await expect(queue.approve(userId, item.id)).rejects.toBeInstanceOf(ServiceError);

    const [row] = await db
      .select()
      .from(threadQueueItemsTable)
      .where(eq(threadQueueItemsTable.id, item.id))
      .limit(1);

    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toBeTruthy();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
