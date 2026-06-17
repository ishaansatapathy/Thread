import { z } from "zod";

import { dailyBriefSchema, generateDailyBrief, isInboxAiConfigured, rankInboxThreads } from "@repo/services/ai";

// ── Server-side brief cache (5 min TTL per user) ─────────────────────────────
// Each generateDailyBrief call makes 6+ Corsair API round-trips + OpenAI.
// Caching prevents hammering both services on every browser focus event.
const briefCache = new Map<string, { data: z.infer<typeof dailyBriefSchema>; expiresAt: number }>();
const BRIEF_CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedBrief(tenantId: string, timeZone: string) {
  const key = `${tenantId}:${timeZone}`;
  const entry = briefCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    briefCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedBrief(tenantId: string, timeZone: string, data: z.infer<typeof dailyBriefSchema>) {
  const key = `${tenantId}:${timeZone}`;
  briefCache.set(key, { data, expiresAt: Date.now() + BRIEF_CACHE_TTL_MS });
  // Prevent unbounded growth — evict oldest entry when cache exceeds 500 users.
  if (briefCache.size > 500) {
    const oldest = briefCache.keys().next().value;
    if (oldest) briefCache.delete(oldest);
  }
}

export function invalidateBriefCache(tenantId: string) {
  for (const key of briefCache.keys()) {
    if (key.startsWith(`${tenantId}:`)) briefCache.delete(key);
  }
}
import { getMeetingPrep } from "@repo/services/ai/meeting-prep";
import { getThreadContext } from "@repo/services/ai/thread-context";
import { getMissedFollowUps } from "@repo/services/ai/missed-followups";
import { getSmartReplies } from "@repo/services/ai/smart-reply";
import { getContactIntel } from "@repo/services/ai/contact-intel";
import { summarizeThread } from "@repo/services/ai/summarize-thread";

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

const contactIntelSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
  totalInteractions: z.number(),
  lastInteractionDaysAgo: z.number().nullable(),
  lastInteractionDate: z.string().optional(),
  sentByUser: z.number(),
  receivedFromContact: z.number(),
  responseRate: z.number().nullable(),
  recentTopics: z.array(z.string()),
  relationshipSummary: z.string(),
  recommendedAction: z.string(),
  recentThreads: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      date: z.string().optional(),
      direction: z.enum(["sent", "received"]),
    }),
  ),
});

const summarizeThreadSchema = z.object({
  threadId: z.string(),
  subject: z.string(),
  participantCount: z.number(),
  messageCount: z.number(),
  summary: z.string(),
  keyDecisions: z.array(z.string()),
  actionItems: z.array(
    z.object({
      action: z.string(),
      owner: z.string().optional(),
      deadline: z.string().optional(),
    }),
  ),
  nextStep: z.string(),
  sentiment: z.enum(["positive", "neutral", "urgent", "negative"]),
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

  /** Contact intelligence — relationship summary for an email contact via Corsair Gmail + OpenAI. */
  contactIntel: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/contact-intel"), tags: TAGS } })
    .input(z.object({ email: z.string().email(), name: z.string().optional() }))
    .output(contactIntelSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await getContactIntel({
          tenantId: ctx.user.id,
          email: input.email,
          name: input.name,
          userEmail: ctx.user.email,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Thread summary — key decisions, action items, and next steps via Corsair Gmail + OpenAI. */
  summarizeThread: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/summarize-thread"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(summarizeThreadSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await summarizeThread({
          tenantId: ctx.user.id,
          threadId: input.threadId,
          userEmail: ctx.user.email,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Daily brief — cached per-user for 5 min to avoid 6+ Corsair calls per refresh. */
  dailyBrief: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/daily-brief"), tags: TAGS } })
    .input(
      z.object({
        timeZone: z.string().max(64).optional(),
        /** Pass true to bypass cache and force a fresh brief from Corsair + OpenAI. */
        refresh: z.boolean().optional(),
      }),
    )
    .output(dailyBriefSchema)
    .query(async ({ ctx, input }) => {
      const timeZone = input.timeZone?.trim() || "UTC";
      try {
        if (!input.refresh) {
          const cached = getCachedBrief(ctx.user.id, timeZone);
          if (cached) return cached;
        }
        const brief = await generateDailyBrief({
          tenantId: ctx.user.id,
          userEmail: ctx.user.email,
          displayName: ctx.user.displayName ?? ctx.user.fullName,
          timeZone,
        });
        setCachedBrief(ctx.user.id, timeZone, brief);
        return brief;
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
