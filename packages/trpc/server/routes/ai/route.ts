import { z } from "zod";

import { dailyBriefSchema, generateDailyBrief, isInboxAiConfigured, rankInboxThreads } from "@repo/services/ai";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["AI"];
const getPath = generatePath("/ai");

const inboxRankThreadSchema = z.object({
  id: z.string().min(1),
  snippet: z.string(),
  subject: z.string().max(998).optional(),
  from: z.string().max(320).optional(),
});

export const aiRouter = router({
  status: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/status"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        openai: z.boolean(),
        model: z.string().optional(),
      }),
    )
    .query(async () => {
      return {
        openai: isInboxAiConfigured(),
        model: isInboxAiConfigured() ? process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini" : undefined,
      };
    }),

  rankInboxThreads: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/inbox/rank"), tags: TAGS } })
    .input(
      z.object({
        threads: z.array(inboxRankThreadSchema).min(1).max(25),
      }),
    )
    .output(
      z.object({
        rankedIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const rankedIds = await rankInboxThreads(input.threads);
        return { rankedIds };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Daily brief — also exposed here so older API bundles pick it up under `ai.*`. */
  dailyBrief: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/daily-brief"), tags: TAGS } })
    .input(
      z.object({
        timeZone: z.string().max(64).optional(),
      }),
    )
    .output(dailyBriefSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await generateDailyBrief({
          tenantId: ctx.user.id,
          userEmail: ctx.user.email,
          displayName: ctx.user.displayName ?? ctx.user.fullName,
          timeZone: input.timeZone,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
