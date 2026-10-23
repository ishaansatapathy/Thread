import { logger } from "@repo/logger";

import { getMeetingService, hasMeetingService } from "../meetings";
import type { ApprovalDefaults } from "../settings";
import { buildFocusSystemAppendix, type AgentFocus } from "./agent-focus";
import type { AgentHistoryMessage } from "./agent";
import { buildSystemPromptFor } from "./agent-internals";
import { detectTopicShift } from "./agent-topic-shift";
import { formatToolMemoryForPrompt, type AgentToolMemoryEntry } from "./agent-tool-memory";

export type AgentRunInput = {
  message: string;
  history?: AgentHistoryMessage[];
  userEmail?: string;
  focus?: AgentFocus;
  toolMemory?: AgentToolMemoryEntry[];
  /** Set when the user is talking to the agent from inside a Thread meeting room. */
  meetingId?: string;
};

async function buildMeetingAppendix(tenantId: string, meetingId: string | undefined): Promise<string> {
  if (!meetingId || !hasMeetingService()) return "";
  try {
    return await getMeetingService().agentContext(tenantId, meetingId);
  } catch (error) {
    logger.warn("agent.meeting_context_failed", {
      meetingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

export type PreparedAgentRun = {
  effectiveFocus: AgentFocus | undefined;
  focusCleared: boolean;
  topicShiftReason?: string;
  history: AgentHistoryMessage[];
  systemPrompt: string;
  newToolMemoryEntries: AgentToolMemoryEntry[];
};

export async function prepareAgentRun(
  tenantId: string,
  input: AgentRunInput,
  approvalDefaults: ApprovalDefaults,
): Promise<PreparedAgentRun> {
  const topicShift = detectTopicShift(input.message, input.focus, input.toolMemory ?? []);
  const effectiveFocus = topicShift.shouldClearFocus ? undefined : input.focus;

  const history =
    effectiveFocus?.threadId || effectiveFocus?.eventId
      ? (input.history ?? []).slice(-4)
      : (input.history ?? []).slice(-12);

  const [focusAppendix, meetingAppendix] = await Promise.all([
    buildFocusSystemAppendix(tenantId, effectiveFocus, input.userEmail),
    buildMeetingAppendix(tenantId, input.meetingId),
  ]);
  const toolMemoryAppendix = formatToolMemoryForPrompt(input.toolMemory ?? []);
  const systemPrompt =
    buildSystemPromptFor(input.userEmail, approvalDefaults) + toolMemoryAppendix + focusAppendix + meetingAppendix;

  return {
    effectiveFocus,
    focusCleared: topicShift.shouldClearFocus,
    topicShiftReason: topicShift.reason,
    history,
    systemPrompt,
    newToolMemoryEntries: [],
  };
}

export function createToolMemoryTracker(
  prepared: PreparedAgentRun,
  existing: AgentToolMemoryEntry[],
) {
  const entries = [...prepared.newToolMemoryEntries];

  return {
    track(entry: AgentToolMemoryEntry | null) {
      if (entry) entries.push(entry);
    },
    getMergedMemory() {
      if (entries.length === 0) return existing;
      return [...existing, ...entries].slice(-12);
    },
    getNewEntries() {
      return entries;
    },
  };
}
