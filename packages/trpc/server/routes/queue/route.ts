import { z } from "zod";

import { getQueueService } from "@repo/services/queue";

import { protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Queue"];
const getPath = generatePath("/queue");

const emailPayloadSchema = z.object({
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(100_000),
  threadId: z.string().optional(),
});

const calendarPayloadSchema = z.object({
  summary: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1),
  timeZone: z.string().max(64).optional(),
  attendeeEmails: z.array(z.string().email()).max(20).optional(),
});

const queueItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["email_send", "email_draft", "calendar_invite", "meeting_bundle"]),
  title: z.string(),
  preview: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  sourceThreadId: z.string().optional(),
  status: z.enum(["pending", "approved", "dismissed", "failed"]),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});

export const queueRouter = router({
  pendingCount: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/pending-count"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ count: z.number().int() }))
    .query(async ({ ctx }) => {
      const queue = getQueueService();
      const count = await queue.pendingCount(ctx.user.id);
      return { count };
    }),

  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/items"), tags: TAGS } })
    .input(
      z.object({
        status: z.enum(["pending", "approved", "dismissed", "failed", "all"]).optional(),
      }),
    )
    .output(z.object({ items: z.array(queueItemSchema) }))
    .query(async ({ ctx, input }) => {
      const queue = getQueueService();
      const items = await queue.listItems(ctx.user.id, { status: input.status ?? "pending" });
      return { items };
    }),

  enqueueEmail: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/email"), tags: TAGS } })
    .input(
      z.object({
        mode: z.enum(["send", "draft"]),
        email: emailPayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      const queue = getQueueService();
      return queue.enqueueEmail(ctx.user.id, input);
    }),

  enqueueCalendar: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/calendar"), tags: TAGS } })
    .input(
      z.object({
        calendar: calendarPayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      const queue = getQueueService();
      return queue.enqueueCalendarInvite(ctx.user.id, input);
    }),

  enqueueMeeting: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/meeting"), tags: TAGS } })
    .input(
      z.object({
        email: emailPayloadSchema,
        calendar: calendarPayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
        sourceThreadId: z.string().optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      const queue = getQueueService();
      return queue.enqueueMeetingBundle(ctx.user.id, {
        bundle: { email: input.email, calendar: input.calendar },
        title: input.title,
        preview: input.preview,
        sourceThreadId: input.sourceThreadId,
      });
    }),

  approve: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/approve"), tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      const queue = getQueueService();
      return queue.approve(ctx.user.id, input.id);
    }),

  dismiss: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/dismiss"), tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      const queue = getQueueService();
      return queue.dismiss(ctx.user.id, input.id);
    }),
});
