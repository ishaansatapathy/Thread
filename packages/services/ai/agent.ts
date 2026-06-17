import { logger } from "@repo/logger";
import { getCalendarService } from "../calendar";
import { ServiceError } from "../errors";
import { getInboxService } from "../inbox";
import { getQueueService } from "../queue";
import { getSettingsService } from "../settings";
import { isOpenAiConfigured } from "./openai";
import type { OpenAiConversationMessage } from "./openai-tools";
import { runOpenAiToolLoop } from "./openai-tools";
import {
  detectInjectionAttempt,
  estimateTokenCount,
  MAX_AGENT_CONTEXT_TOKENS,
} from "./agent-guard";
import { AGENT_TOOLS, buildSystemPromptFor } from "./agent-internals";
import { buildToolExecutor } from "./agent-executor";

export type AgentHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentActionCard = {
  kind: "email_queued" | "calendar_queued" | "inbox_search" | "inbox_ranked" | "queue_list" | "thread" | "calendar";
  title: string;
  detail?: string;
  href?: string;
  lines?: string[];
  disposition?: "sent" | "queued";
  queueItemId?: string;
  threadId?: string;
};

export type AgentChatResult = {
  reply: string;
  actions: AgentActionCard[];
};

export function isAgentConfigured() {
  return isOpenAiConfigured();
}

export async function runAgentChat(
  tenantId: string,
  input: { message: string; history?: AgentHistoryMessage[]; userEmail?: string },
): Promise<AgentChatResult> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  const injectionCheck = detectInjectionAttempt(input.message);
  if (injectionCheck.flagged) {
    logger.warn("agent.injection_attempt_blocked", {
      tenantId,
      reason: injectionCheck.reason,
      messagePreview: input.message.slice(0, 200),
    });
    return {
      reply:
        "I can't process that request as it appears to contain instructions that could compromise security. " +
        "If you were trying to do something specific, please rephrase it.",
      actions: [],
    };
  }

  const history = input.history ?? [];
  const previewMessages: OpenAiConversationMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.message.trim() },
  ];
  const estimatedTokens = estimateTokenCount(previewMessages);
  if (estimatedTokens > MAX_AGENT_CONTEXT_TOKENS) {
    logger.warn("agent.context_too_large", { tenantId, estimatedTokens });
    return {
      reply: "The conversation history is too long for me to process safely. Please start a new conversation.",
      actions: [],
    };
  }

  const inbox = getInboxService();
  const queue = getQueueService();
  const calendar = getCalendarService();
  const settings = getSettingsService();
  const approvalDefaults = await settings.getApprovalDefaults(tenantId);
  const actions: AgentActionCard[] = [];
  const emailQueueFingerprints = new Set<string>();
  const sendCounter = { count: 0 };

  const executeTool = buildToolExecutor({
    tenantId,
    userEmail: input.userEmail,
    approvalDefaults,
    inbox,
    queue,
    calendar,
    actions,
    emailQueueFingerprints,
    sendCounter,
  });

  const messages: OpenAiConversationMessage[] = [
    { role: "system", content: buildSystemPromptFor(input.userEmail, approvalDefaults) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.message.trim() },
  ];

  const { content } = await runOpenAiToolLoop(messages, AGENT_TOOLS, executeTool, {
    maxRounds: 6,
    timeoutMs: 120_000,
  });

  return { reply: content, actions };
}
