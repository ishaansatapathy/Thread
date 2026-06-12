import { z } from "zod";

import { getInboxService } from "@repo/services/inbox";
import {
  emailBodySchema,
  safeEmailSubjectSchema,
  singleRecipientSchema,
} from "@repo/services/validation/email";

import { TRPCError } from "@trpc/server";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Inbox"];
const getPath = generatePath("/inbox");

const inboxMessageSchema = z.object({
  id: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  body: z.string(),
  snippet: z.string(),
});

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
  messages: z.array(inboxMessageSchema).optional(),
  suggestedReplyTo: z.string().optional(),
  messageCount: z.number().optional(),
});

const connectionStatusSchema = z.object({
  gmail: z.enum(["connected", "missing_credentials", "not_connected", "not_configured"]),
});

const composeInputSchema = z.object({
  to: singleRecipientSchema,
  subject: safeEmailSubjectSchema,
  body: emailBodySchema,
  threadId: z.string().optional(),
});

function assertDirectSendAllowed() {
  if (process.env.THREAD_ALLOW_DIRECT_SEND?.trim() !== "true") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Direct send is disabled. Add the action to the approval queue instead.",
    });
  }
}

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
      try {
        const inbox = getInboxService();
        return await inbox.listThreads(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  getThread: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/threads/{threadId}"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(inboxThreadSchema.nullable())
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.getThread(ctx.user.id, input.threadId, { userEmail: ctx.user.email });
      } catch (error) {
        mapServiceError(error);
      }
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
      assertDirectSendAllowed();
      try {
        const inbox = getInboxService();
        return await inbox.sendMessage(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
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
      try {
        const inbox = getInboxService();
        return await inbox.createDraft(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
