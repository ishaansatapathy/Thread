import { z } from "zod";

import { logger } from "@repo/logger";
import { isAgentConfigured, runAgentChat } from "@repo/services/ai/agent";
import { eq } from "@repo/database";
import db from "@repo/database";
import { agentChatHistoryTable } from "@repo/database/schema";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";
import { invalidateBriefCache } from "../ai/route";

const TAGS = ["Agent"];
const getPath = generatePath("/agent");

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const MAX_STORED_MESSAGES = 40;

const actionCardSchema = z.object({
  kind: z.enum(["email_queued", "calendar_queued", "inbox_search", "inbox_ranked", "queue_list", "thread", "calendar"]),
  title: z.string(),
  detail: z.string().optional(),
  href: z.string().optional(),
  lines: z.array(z.string()).optional(),
  disposition: z.enum(["sent", "queued"]).optional(),
  queueItemId: z.string().uuid().optional(),
  threadId: z.string().optional(),
});

export const agentRouter = router({
  status: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/status"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        ready: z.boolean(),
        model: z.string().optional(),
      }),
    )
    .query(async () => ({
      ready: isAgentConfigured(),
      model: isAgentConfigured() ? process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini" : undefined,
    })),

  chat: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/chat"), tags: TAGS } })
    .input(
      z.object({
        message: z.string().trim().min(1).max(4000),
        history: z.array(historyMessageSchema).max(24).optional(),
      }),
    )
    .output(
      z.object({
        reply: z.string(),
        actions: z.array(actionCardSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Structured audit entry — every agent invocation is traceable by userId.
      logger.info("agent.chat_invoked", {
        userId: ctx.user.id,
        messageLength: input.message.length,
        historyLength: input.history?.length ?? 0,
      });
      try {
        const result = await runAgentChat(ctx.user.id, {
          message: input.message,
          history: input.history,
          userEmail: ctx.user.email,
        });
        // If the agent took any outbound actions, invalidate the brief cache so
        // the user sees accurate "Needs attention" items on /brief immediately.
        if (result.actions.some((a) => a.kind === "email_queued" || a.kind === "calendar_queued")) {
          invalidateBriefCache(ctx.user.id);
        }
        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  getHistory: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/history"), tags: TAGS } })
    .input(z.object({}))
    .output(z.array(historyMessageSchema))
    .query(async ({ ctx }) => {
      try {
        const [row] = await db
          .select({ messages: agentChatHistoryTable.messages })
          .from(agentChatHistoryTable)
          .where(eq(agentChatHistoryTable.userId, ctx.user.id))
          .limit(1);
        return (row?.messages ?? []).slice(-MAX_STORED_MESSAGES);
      } catch {
        return [];
      }
    }),

  saveHistory: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/history"), tags: TAGS } })
    .input(z.object({ messages: z.array(historyMessageSchema).max(MAX_STORED_MESSAGES) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const trimmed = input.messages.slice(-MAX_STORED_MESSAGES);
        await db
          .insert(agentChatHistoryTable)
          .values({ userId: ctx.user.id, messages: trimmed, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: agentChatHistoryTable.userId,
            set: { messages: trimmed, updatedAt: new Date() },
          });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }),

  clearHistory: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/history"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      try {
        await db
          .delete(agentChatHistoryTable)
          .where(eq(agentChatHistoryTable.userId, ctx.user.id));
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }),
});
