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
});

const connectionStatusSchema = z.object({
  gmail: z.enum(["connected", "missing_credentials", "not_connected", "not_configured"]),
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
});
