import { z } from "zod";

import { isAgentConfigured, runAgentChat } from "@repo/services/ai/agent";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Agent"];
const getPath = generatePath("/agent");

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const actionCardSchema = z.object({
  kind: z.enum(["email_queued", "calendar_queued", "inbox_search", "inbox_ranked", "queue_list", "thread"]),
  title: z.string(),
  detail: z.string().optional(),
  href: z.string().optional(),
  lines: z.array(z.string()).optional(),
  disposition: z.enum(["sent", "queued"]).optional(),
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
      try {
        return await runAgentChat(ctx.user.id, {
          message: input.message,
          history: input.history,
          userEmail: ctx.user.email,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
