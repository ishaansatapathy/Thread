/**
 * Picks model + reasoning effort for every AI call in Thread.
 *
 * Two tiers (defaults in model-catalog.ts):
 *   fast  — OPENAI_MODEL, default gpt-6-luna. Summaries, smart replies,
 *           ranking, brief and everyday agent actions. Effort none/low.
 *   smart — OPENAI_MODEL_SMART, default gpt-6.1-sol. Multi-app orchestration,
 *           high-stakes writing, analysis over many emails, dates pulled out of
 *           a thread. OPENAI_MODEL_SMART=off keeps everything on fast.
 *
 * Classification is local and heuristic on purpose: spending a model call to
 * decide which model to call would cost more than it saves on the common path.
 * The agent loop also escalates mid-run when the fast model is struggling
 * (see AGENT_ESCALATION and runOpenAiToolLoop).
 */
import { logger } from "@repo/logger";

import type { ModelTier, ReasoningEffort } from "./model-catalog";
import { getOpenAiModel, getSmartModel } from "./openai-config";

export type { ModelTier } from "./model-catalog";

export type ModelDecision = {
  tier: ModelTier;
  model: string;
  effort: ReasoningEffort;
  reason: string;
};

export type AiTask =
  | "summarize_thread"
  | "smart_reply"
  | "inbox_priority"
  | "thread_context"
  | "contact_intel"
  | "missed_followups"
  | "meeting_slots"
  | "meeting_prep"
  | "daily_brief";

/** Above this many input characters a one-shot task is escalated (≈ tokens × 4). */
const TASK_ESCALATION_CHARS: Record<AiTask, number> = {
  summarize_thread: 60_000,
  smart_reply: 40_000,
  inbox_priority: Number.POSITIVE_INFINITY,
  thread_context: 60_000,
  contact_intel: 60_000,
  missed_followups: Number.POSITIVE_INFINITY,
  meeting_slots: Number.POSITIVE_INFINITY,
  meeting_prep: 30_000,
  daily_brief: 30_000,
};

/**
 * Reasoning effort for one-shot tasks on the fast tier. `none` is the
 * lowest-latency setting (classification, summaries); `low` buys a little
 * thinking for tasks that do date math or synthesise across many emails.
 */
const TASK_EFFORT: Record<AiTask, ReasoningEffort> = {
  summarize_thread: "none",
  smart_reply: "none",
  inbox_priority: "none",
  thread_context: "none",
  contact_intel: "none",
  missed_followups: "none",
  meeting_slots: "low",
  meeting_prep: "low",
  daily_brief: "low",
};

function decide(tier: ModelTier, effort: { fast: ReasoningEffort; smart: ReasoningEffort }, reason: string): ModelDecision {
  if (tier === "smart") {
    const smart = getSmartModel();
    if (smart) return { tier, model: smart, effort: effort.smart, reason };
    return { tier: "fast", model: getOpenAiModel(), effort: effort.fast, reason: `${reason}|smart_tier_off` };
  }
  return { tier, model: getOpenAiModel(), effort: effort.fast, reason };
}

/** One-shot features: fast by default, smart only when the input is genuinely large. */
export function resolveTaskModel(task: AiTask, inputChars: number): ModelDecision {
  const effort = { fast: TASK_EFFORT[task], smart: "low" as const };
  if (inputChars > TASK_ESCALATION_CHARS[task]) return decide("smart", effort, `${task}:large_input`);
  return decide("fast", effort, task);
}

/** Agent tool loops: `low` is the documented starting point for tool use; smart gets room to plan. */
const AGENT_EFFORT = { fast: "low", smart: "medium" } as const satisfies Record<ModelTier, ReasoningEffort>;

// ---------------------------------------------------------------------------
// Agent classification
// ---------------------------------------------------------------------------

const LONG_MESSAGE_CHARS = 600;
const LONG_HISTORY_TOKENS = 3_000;
const HIGH_TOOL_MEMORY_COUNT = 8;

/** Each entry is one distinct kind of action; mentioning several means orchestration. */
const INTENTS: Array<{ name: string; pattern: RegExp }> = [
  { name: "email", pattern: /\b(send|reply|respond|email|mail|forward|draft|write (to|back)|follow[- ]?up)\b/ },
  {
    name: "schedule",
    pattern: /\b(schedule|book|invite|meet|meeting|set up a call|calendar|reschedule|move (the|my) (meeting|call)|find a (time|slot)|availability|(are|is) (all |both )?free)\b/,
  },
  { name: "meet", pattern: /\b(g ?meet|google meet|meet link|video call)\b/ },
  { name: "drive", pattern: /\b(drive|save (it|this|them|the attachments?)|upload|folder)\b/ },
  { name: "sheet", pattern: /\b(sheet|spreadsheet|excel|table of)\b/ },
  { name: "doc", pattern: /\b(google doc|document|doc\b|notes|write[- ]?up|report)\b/ },
  { name: "share", pattern: /\b(share|give access|permission)\b/ },
  { name: "cleanup", pattern: /\b(archive|label|mark (as )?read|trash|delete|cancel|unsubscribe)\b/ },
];

const CHAIN = /\b(and then|then|after that|once (done|that'?s done)|followed by|also|aur phir|phir|uske baad)\b/g;

/** High-stakes writing where tone mistakes are costly. */
const HIGH_STAKES = /\b(investor|term sheet|legal|lawyer|contract|nda|negotiat\w*|apolog\w*|complain\w*|escalat\w*|resign\w*|offer letter|salary|compensation|terminat\w*|layoff|refund dispute|chargeback|condolence|performance review|board)\b/;

/** Analysis / synthesis across many items. */
const ANALYSIS = /\b(analy[sz]e|analysis|compare|comparison|trends?|insights?|prioriti[sz]e (my|the) (week|day|inbox)|strategy|plan (my|the)|breakdown|audit|categori[sz]e|research|detailed|in[- ]depth|thorough|comprehensive|step by step|carefully)\b/;

/** Bulk scope over the mailbox. */
const BULK_SCOPE = /\b(all (my |the )?(emails|mails|threads|messages|receipts|invoices)|every (email|mail|thread)|last (month|quarter|year)|this (month|quarter)|past \d+ (days|weeks|months)|everything from)\b/;

/** Building a sheet/doc from data that first has to be found and extracted. */
const EXTRACT_INTO_FILE = /\b(sheet|spreadsheet|doc|document|notes|report|table)\b[^.?!]*\b(from|based on|using|out of)\b[^.?!]*\b(emails?|mails?|inbox|receipts?|invoices?|transcripts?|meetings?|threads?|attachments?)\b/;

/** Meeting notes from transcripts are long and need careful extraction. */
const TRANSCRIPT = /\b(transcripts?|meeting notes|meeting minutes|minutes of the meeting|action items from)\b/;

/** Bulk mailbox housekeeping is simple even when the scope is large. */
const BULK_HOUSEKEEPING = /\b(archive|mark\b[^.?!]*\b(read|unread)|label|unsubscribe|trash|delete)\b/;

/** Pulling a date/time out of an email to schedule from it — small models misread dates. */
const SCHEDULE_FROM_THREAD = new RegExp(
  [
    String.raw`\b(from|in|per|based on|mentioned in) (this|the|that|his|her|their) (email|mail|thread|message)\b`,
    String.raw`\b(email|mail|message|thread)\b[^.?!]*\b(asks?|asking|wants?|proposes?|proposing|suggests?|requests?)\b[^.?!]*\b(meet|meeting|call|catch up|sync)\b`,
    String.raw`\b(they|he|she) (asked|proposed|suggested) (a |to )?(meet|meeting|call|time)\b`,
    String.raw`\bwhen (we'?re|we are|everyone is|they'?re) (all )?free\b`,
    String.raw`\b(are|is) (all |both )?free\b`,
    String.raw`\bfind a (time|slot)\b`,
  ].join("|"),
);

/** The user is telling us the previous answer was wrong. */
const CORRECTION = /\b(that'?s (wrong|not right|incorrect)|not what i (asked|meant)|no,? i meant|try again|you got it wrong|wrong (person|date|time|email)|galat|phir se|dobara)\b/;

/** Several people involved → coordination. */
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const GROUP = /\b(everyone|the team|all of them|attendees|participants)\b/;

export type AgentClassificationInput = {
  message: string;
  historyTokens: number;
  toolMemoryCount: number;
  /** Agent is focused on a specific email thread (user opened it from Inbox). */
  hasThreadFocus?: boolean;
};

export function classifyAgentRequest(input: AgentClassificationInput): { tier: ModelTier; reason: string } {
  const message = input.message.trim();
  const text = message.toLowerCase();

  if (message.length > LONG_MESSAGE_CHARS) return { tier: "smart", reason: "long_message" };
  if (input.historyTokens > LONG_HISTORY_TOKENS) return { tier: "smart", reason: "long_history" };
  if (input.toolMemoryCount > HIGH_TOOL_MEMORY_COUNT) return { tier: "smart", reason: "deep_tool_memory" };
  if (CORRECTION.test(text)) return { tier: "smart", reason: "user_correction" };
  if (HIGH_STAKES.test(text)) return { tier: "smart", reason: "high_stakes_writing" };
  if (TRANSCRIPT.test(text)) return { tier: "smart", reason: "transcript_extraction" };
  if (EXTRACT_INTO_FILE.test(text)) return { tier: "smart", reason: "extract_into_file" };
  if (ANALYSIS.test(text)) return { tier: "smart", reason: "analysis" };
  if (BULK_SCOPE.test(text) && !BULK_HOUSEKEEPING.test(text)) {
    return { tier: "smart", reason: "bulk_scope" };
  }

  const intents = INTENTS.filter((intent) => intent.pattern.test(text)).map((i) => i.name);
  const chainHits = text.match(CHAIN)?.length ?? 0;
  if (intents.length >= 3) return { tier: "smart", reason: `multi_intent:${intents.join("+")}` };
  if (intents.length >= 2 && chainHits >= 1) return { tier: "smart", reason: `chained:${intents.join("+")}` };
  if (chainHits >= 2) return { tier: "smart", reason: "multi_step_phrasing" };

  const schedules = intents.includes("schedule") || intents.includes("meet");
  if (schedules && (SCHEDULE_FROM_THREAD.test(text) || input.hasThreadFocus)) {
    return { tier: "smart", reason: "schedule_from_thread" };
  }
  const people = new Set(text.match(EMAIL_ADDRESS) ?? []).size;
  if (schedules && (people >= 2 || GROUP.test(text))) return { tier: "smart", reason: "group_coordination" };

  return { tier: "fast", reason: intents.length ? `simple:${intents.join("+")}` : "simple" };
}

export function resolveAgentModel(input: AgentClassificationInput): ModelDecision {
  const { tier, reason } = classifyAgentRequest(input);
  return decide(tier, AGENT_EFFORT, reason);
}

/**
 * When a request started on the fast model, hand the rest of the tool loop to
 * the smart model once it shows signs of struggling.
 */
export const AGENT_ESCALATION = {
  afterRounds: 3,
  afterToolErrors: 2,
} as const;

/** Model + mid-run escalation options for runOpenAiToolLoop, with logging. */
export function planAgentModel(tenantId: string, input: AgentClassificationInput) {
  const decision = resolveAgentModel(input);
  logger.info("agent.model_selected", {
    tenantId,
    tier: decision.tier,
    model: decision.model,
    effort: decision.effort,
    reason: decision.reason,
  });

  const smart = getSmartModel();
  const escalation =
    decision.tier === "fast" && smart && smart !== decision.model
      ? {
          model: smart,
          effort: AGENT_EFFORT.smart,
          ...AGENT_ESCALATION,
          onEscalate: (reason: string) => logger.info("agent.model_escalated", { tenantId, model: smart, reason }),
        }
      : undefined;

  return { model: decision.model, effort: decision.effort, escalation };
}
