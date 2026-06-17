import { z } from "zod";

import { ServiceError } from "../errors";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

export type InboxRankInput = {
  id: string;
  snippet: string;
  subject?: string;
  from?: string;
};

export type InboxUrgency = "critical" | "high" | "medium" | "low" | "noise";

export type InboxPriorityCategory =
  | "reply_needed"
  | "deadline"
  | "meeting"
  | "billing"
  | "fyi"
  | "promo";

export type InboxRankItem = {
  id: string;
  urgency: InboxUrgency;
  /** 0–100 — higher = needs attention sooner */
  score: number;
  /** One-line explanation a human can trust */
  reason: string;
  category: InboxPriorityCategory;
};

export type InboxAnalysisResult = {
  rankedIds: string[];
  items: InboxRankItem[];
  summary: {
    total: number;
    critical: number;
    high: number;
    replyNeeded: number;
    analyzedAt: string;
  };
};

const urgencySchema = z.enum(["critical", "high", "medium", "low", "noise"]);
const categorySchema = z.enum(["reply_needed", "deadline", "meeting", "billing", "fyi", "promo"]);

const analysisResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      urgency: urgencySchema,
      score: z.number().min(0).max(100),
      reason: z.string().min(4).max(160),
      category: categorySchema,
    }),
  ),
});

const URGENCY_WEIGHT: Record<InboxUrgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  noise: 4,
};

function buildAnalysisPrompt(threads: InboxRankInput[]) {
  const lines = threads.slice(0, 40).map((thread, index) => {
    const subject = (thread.subject?.trim() || "No subject").slice(0, 80);
    const from = (thread.from?.trim() || "Unknown sender").slice(0, 40);
    const snippet = (thread.snippet.trim() || "(empty)").slice(0, 120);
    return `${index + 1}. id=${thread.id} | from=${from} | subject=${subject} | ${snippet}`;
  });

  return [
    "Analyze these email threads for a busy professional.",
    "For EACH thread return:",
    "- urgency: critical | high | medium | low | noise",
    "- score: 0-100 (100 = must handle today)",
    "- reason: one specific sentence explaining WHY (mention sender intent, deadline, or risk — never generic)",
    "- category: reply_needed | deadline | meeting | billing | fyi | promo",
    "",
    "Scoring guide:",
    "- critical (90-100): direct ask waiting on user, deadline today, security/billing",
    "- high (70-89): reply expected, time-sensitive this week",
    "- medium (40-69): useful but not urgent",
    "- low (15-39): FYI, newsletters with some relevance",
    "- noise (0-14): promotions, automated, no action",
    "",
    'Return JSON only: {"items":[{"id":"...","urgency":"high","score":82,"reason":"...","category":"reply_needed"}, ...]}',
    "Include every thread id exactly once.",
    "",
    ...lines,
  ].join("\n");
}

function fallbackItem(thread: InboxRankInput, index: number): InboxRankItem {
  const subject = thread.subject?.toLowerCase() ?? "";
  const snippet = thread.snippet.toLowerCase();
  const text = `${subject} ${snippet}`;

  const looksPromo =
    /unsubscribe|newsletter|promo|sale|off\b|marketing/.test(text) ||
    /no-reply|noreply/.test(thread.from?.toLowerCase() ?? "");
  const looksUrgent =
    /urgent|asap|deadline|due today|action required|please reply|waiting for your/.test(text);

  if (looksPromo) {
    return {
      id: thread.id,
      urgency: "noise",
      score: 8,
      reason: "Automated or promotional — safe to review later.",
      category: "promo",
    };
  }
  if (looksUrgent) {
    return {
      id: thread.id,
      urgency: "high",
      score: 78,
      reason: "Language suggests a time-sensitive request or deadline.",
      category: "reply_needed",
    };
  }

  const score = Math.max(20, 55 - index * 4);
  return {
    id: thread.id,
    urgency: index < 3 ? "medium" : "low",
    score,
    reason: index === 0 ? "Most recent thread in your inbox." : "Routine inbox item — review when you have time.",
    category: "fyi",
  };
}

function normalizeItems(threads: InboxRankInput[], raw: z.infer<typeof analysisResponseSchema>): InboxRankItem[] {
  const byId = new Map(raw.items.map((item) => [item.id, item]));
  const normalized: InboxRankItem[] = [];

  for (const [index, thread] of threads.entries()) {
    const item = byId.get(thread.id);
    if (!item) {
      normalized.push(fallbackItem(thread, index));
      continue;
    }
    normalized.push({
      id: item.id,
      urgency: item.urgency,
      score: Math.round(Math.max(0, Math.min(100, item.score))),
      reason: item.reason.trim(),
      category: item.category,
    });
  }

  normalized.sort((a, b) => {
    const urgencyDiff = URGENCY_WEIGHT[a.urgency] - URGENCY_WEIGHT[b.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.score - a.score;
  });

  return normalized;
}

function buildSummary(items: InboxRankItem[]): InboxAnalysisResult["summary"] {
  return {
    total: items.length,
    critical: items.filter((i) => i.urgency === "critical").length,
    high: items.filter((i) => i.urgency === "high").length,
    replyNeeded: items.filter((i) => i.category === "reply_needed").length,
    analyzedAt: new Date().toISOString(),
  };
}

export function isInboxAiConfigured() {
  return isOpenAiConfigured();
}

export async function analyzeInboxThreads(threads: InboxRankInput[]): Promise<InboxAnalysisResult> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  if (threads.length === 0) {
    return {
      rankedIds: [],
      items: [],
      summary: { total: 0, critical: 0, high: 0, replyNeeded: 0, analyzedAt: new Date().toISOString() },
    };
  }

  if (threads.length === 1) {
    const only = threads[0]!;
    const item: InboxRankItem = {
      id: only.id,
      urgency: "medium",
      score: 50,
      reason: "Single thread — open to see if a reply is needed.",
      category: "fyi",
    };
    return {
      rankedIds: [only.id],
      items: [item],
      summary: buildSummary([item]),
    };
  }

  const content = await createChatCompletion(
    [
      {
        role: "system",
        content:
          "You triage email for executives. Be specific in reasons — cite subject cues, sender type, or implied deadline. Respond with valid JSON only.",
      },
      { role: "user", content: buildAnalysisPrompt(threads) },
    ],
    { jsonObject: true, temperature: 0.15 },
  );

  let parsed: z.infer<typeof analysisResponseSchema>;
  try {
    parsed = analysisResponseSchema.parse(JSON.parse(content));
  } catch {
    const items = threads.map((thread, index) => fallbackItem(thread, index));
    items.sort((a, b) => b.score - a.score);
    return {
      rankedIds: items.map((i) => i.id),
      items,
      summary: buildSummary(items),
    };
  }

  const items = normalizeItems(threads, parsed);
  return {
    rankedIds: items.map((i) => i.id),
    items,
    summary: buildSummary(items),
  };
}

/** Backward-compatible helper — returns ordered ids only. */
export async function rankInboxThreads(threads: InboxRankInput[]): Promise<string[]> {
  const analysis = await analyzeInboxThreads(threads);
  return analysis.rankedIds;
}
