import { z } from "zod";

import { getInboxService } from "@repo/services/inbox";

import { protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Inbox"];
const getPath = generatePath("/inbox");

const inboxThreadSchema = z.object({
  id: z.string(),
  snippet: z.string(),
  historyId: z.string().optional(),
  subject: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  body: z.string().optional(),
  messageId: z.string().optional(),
});

const connectionStatusSchema = z.object({
  gmail: z.enum(["connected", "missing_credentials", "not_connected", "not_configured"]),
});

const composeInputSchema = z.object({
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(100_000),
  threadId: z.string().optional(),
});

export const inboxRouter = router({
  connectionStatus: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/connection-status"), tags: TAGS } })
    .input(z.object({}))
    .output(connectionStatusSchema)
    .query(async ({ ctx }) => {
      const inbox = getInboxService();
      return inbox.getConnectionStatus(ctx.user.id);
    }),

  listThreads: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/threads"), tags: TAGS } })
    .input(
      z.object({
        maxResults: z.number().int().min(1).max(50).optional(),
        pageToken: z.string().optional(),
      }),
    )
    .output(
      z.object({
        threads: z.array(inboxThreadSchema),
        nextPageToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.listThreads(ctx.user.id, input);
    }),

  getThread: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/threads/{threadId}"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(inboxThreadSchema.nullable())
    .query(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.getThread(ctx.user.id, input.threadId);
    }),

  sendMessage: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/send"), tags: TAGS } })
    .input(composeInputSchema)
    .output(
      z.object({
        id: z.string().optional(),
        threadId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.sendMessage(ctx.user.id, input);
    }),

  createDraft: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/drafts"), tags: TAGS } })
    .input(composeInputSchema)
    .output(
      z.object({
        id: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.createDraft(ctx.user.id, input);
    }),
});
