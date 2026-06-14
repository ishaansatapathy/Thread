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
  bodyHtml: z.string().optional(),
  snippet: z.string(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        mimeType: z.string(),
        size: z.number(),
        attachmentId: z.string().optional(),
      }),
    )
    .optional(),
});

const inboxThreadSchema = z.object({
  id: z.string(),
  snippet: z.string(),
  historyId: z.string().optional(),
  subject: z.string().optional(),
  from: z.string().optional(),
  fromName: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  body: z.string().optional(),
  messageId: z.string().optional(),
  messages: z.array(inboxMessageSchema).optional(),
  suggestedReplyTo: z.string().optional(),
  messageCount: z.number().optional(),
  unread: z.boolean().optional(),
});

const inboxDraftSchema = z.object({
  id: z.string(),
  messageId: z.string().optional(),
  threadId: z.string().optional(),
  subject: z.string().optional(),
  to: z.string().optional(),
  snippet: z.string(),
  updatedAt: z.string().optional(),
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
        maxResults: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional(),
        query: z.string().trim().max(512).optional(),
        refresh: z.boolean().optional(),
      }),
    )
    .output(
      z.object({
        threads: z.array(inboxThreadSchema),
        nextPageToken: z.string().optional(),
        stale: z.boolean().optional(),
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

  listCachedThreads: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/threads/cached"), tags: TAGS } })
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).optional(),
        query: z.string().trim().max(512).optional(),
      }),
    )
    .output(z.object({ threads: z.array(inboxThreadSchema) }))
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.listCachedThreads(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listDrafts: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/drafts"), tags: TAGS } })
    .input(
      z.object({
        maxResults: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional(),
      }),
    )
    .output(
      z.object({
        drafts: z.array(inboxDraftSchema),
        nextPageToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.listDrafts(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  getDraft: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/drafts/{draftId}"), tags: TAGS } })
    .input(z.object({ draftId: z.string().min(1) }))
    .output(
      z
        .object({
          id: z.string(),
          to: z.string().optional(),
          subject: z.string().optional(),
          body: z.string(),
          threadId: z.string().optional(),
        })
        .nullable(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.getDraft(ctx.user.id, input.draftId);
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

  markThreadRead: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/read"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.markThreadRead(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  archiveThread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/archive"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.archiveThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listLabels: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/labels"), tags: TAGS } })
    .input(z.object({}))
    .output(z.array(z.object({ id: z.string(), name: z.string(), type: z.string().optional() })))
    .query(async ({ ctx }) => {
      const inbox = getInboxService();
      return inbox.listLabels(ctx.user.id);
    }),

  applyLabel: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/labels"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1), labelId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.applyLabel(ctx.user.id, input.threadId, input.labelId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  removeLabel: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/threads/{threadId}/labels/{labelId}"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1), labelId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.removeLabel(ctx.user.id, input.threadId, input.labelId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  disconnectGmail: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/disconnect"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      try {
        const inbox = getInboxService();
        await inbox.disconnect(ctx.user.id);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
