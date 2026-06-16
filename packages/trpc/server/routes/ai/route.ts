import { z } from "zod";

import { dailyBriefSchema, generateDailyBrief, isInboxAiConfigured, rankInboxThreads } from "@repo/services/ai";
import { getMeetingPrep } from "@repo/services/ai/meeting-prep";
import { getThreadContext } from "@repo/services/ai/thread-context";
import { getMissedFollowUps } from "@repo/services/ai/missed-followups";
import { getSmartReplies } from "@repo/services/ai/smart-reply";

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
        threads: z.array(inboxRankThreadSchema).min(1).max(50),
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

  /** Smart Context Panel — why this email matters, related threads/events, follow-up. */
  threadContext: protectedProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getThreadContext({
          tenantId: ctx.user.id,
          threadId: input.threadId,
          userEmail: ctx.user.email,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Meeting Prep AI — agenda, talking points, risks, related emails. */
  meetingPrep: protectedProcedure
    .input(z.object({ eventId: z.string().min(1), timeZone: z.string().max(64).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getMeetingPrep({
          tenantId: ctx.user.id,
          eventId: input.eventId,
          timeZone: input.timeZone,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Missed follow-ups — meetings with no follow-up email sent. */
  missedFollowUps: protectedProcedure
    .input(z.object({ timeZone: z.string().max(64).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getMissedFollowUps({
          tenantId: ctx.user.id,
          userEmail: ctx.user.email,
          timeZone: input.timeZone,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Smart Reply — 3 AI-generated reply suggestions for an open thread. */
  smartReplies: protectedProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getSmartReplies({
          tenantId: ctx.user.id,
          threadId: input.threadId,
          userEmail: ctx.user.email,
        });
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
