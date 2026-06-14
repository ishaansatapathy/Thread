/**
 * Streaming wrapper around runAgentChat.
 *
 * Accepts a `onToolCall` callback that is invoked synchronously before each
 * tool executes, allowing the HTTP layer to push SSE "status" events to the
 * client so they see "Searching inbox…" in real-time instead of waiting for
 * the full 120s completion.
 */

import { logger } from "@repo/logger";
import { getCalendarService } from "../calendar";
import { getContactsService } from "../contacts";
import { ServiceError } from "../errors";
import { getInboxService } from "../inbox";
import { getQueueService } from "../queue";
import { getSettingsService } from "../settings";
import { isOpenAiConfigured } from "./openai";
import { rankInboxThreads } from "./inbox-priority";
import type { OpenAiConversationMessage, OpenAiToolDefinition } from "./openai-tools";
import { runOpenAiToolLoop } from "./openai-tools";
import {
  detectInjectionAttempt,
  enforceEmailSendCap,
  estimateTokenCount,
  fenceEmailData,
  validateAgentEmailArgs,
  type SendCounter,
  MAX_AGENT_CONTEXT_TOKENS,
} from "./agent-guard";
import type { AgentActionCard, AgentChatResult, AgentHistoryMessage } from "./agent";
import { AGENT_TOOLS, buildSystemPromptFor, threadLine } from "./agent-internals";

export async function runAgentChatStream(
  tenantId: string,
  input: { message: string; history?: AgentHistoryMessage[]; userEmail?: string },
  onToolCall: (toolName: string) => void,
  onTokenDelta?: (delta: string) => void,
): Promise<AgentChatResult> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  const injectionCheck = detectInjectionAttempt(input.message);
  if (injectionCheck.flagged) {
    logger.warn("agent.stream.injection_blocked", { tenantId, reason: injectionCheck.reason });
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
  if (estimateTokenCount(previewMessages) > MAX_AGENT_CONTEXT_TOKENS) {
    return {
      reply: "The conversation history is too long. Please start a new conversation.",
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
  const sendCounter: SendCounter = { count: 0 };

  const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    // Fire the streaming callback before the (potentially slow) tool runs.
    onToolCall(name);

    switch (name) {
      case "search_inbox": {
        const query = typeof args.query === "string" ? args.query.trim() : undefined;
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 10, 1), 25);
        const result = await inbox.listThreads(tenantId, { maxResults, query });
        const lines = result.threads.map((t) => threadLine(t));
        const fencedLines = lines.map((l) => fenceEmailData(l));
        actions.push({
          kind: "inbox_search",
          title: query ? `Search: ${query}` : "Recent inbox",
          detail: `${result.threads.length} thread(s)`,
          href: query ? `/inbox?focus=search` : "/inbox",
          lines: lines.slice(0, 8),
        });
        return JSON.stringify({ threads: result.threads, count: result.threads.length, fencedLines });
      }

      case "get_thread": {
        const threadId = String(args.threadId ?? "");
        const thread = await inbox.getThread(tenantId, threadId, { userEmail: input.userEmail });
        if (!thread) return JSON.stringify({ error: "Thread not found" });
        const fencedMessages = (thread.messages ?? []).slice(0, 5).map((m) => ({
          from: m.from ?? "?",
          body: fenceEmailData(m.body.slice(0, 2000)),
        }));
        actions.push({
          kind: "thread",
          title: thread.subject?.trim() || "Thread",
          detail: thread.fromName || thread.from,
          href: `/inbox`,
          lines: (thread.messages ?? []).slice(0, 5).map((m) => `${m.from ?? "?"}: ${m.body.slice(0, 200)}`),
        });
        return JSON.stringify({ thread: { ...thread, messages: fencedMessages } });
      }

      case "rank_inbox": {
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 15, 1), 25);
        const listed = await inbox.listThreads(tenantId, { maxResults });
        const rankedIds = await rankInboxThreads(
          listed.threads.map((t) => ({ id: t.id, snippet: t.snippet, subject: t.subject, from: t.fromName ?? t.from })),
        );
        const byId = new Map(listed.threads.map((t) => [t.id, t]));
        const ordered = rankedIds.map((id) => byId.get(id)).filter(Boolean);
        actions.push({
          kind: "inbox_ranked",
          title: "Priority ranking",
          detail: `${ordered.length} threads by urgency`,
          href: "/inbox",
          lines: ordered.map((t) => threadLine(t!)),
        });
        return JSON.stringify({ rankedIds, threads: ordered });
      }

      case "queue_email": {
        let validated: { to: string; subject: string; body: string };
        try {
          validated = validateAgentEmailArgs(args);
        } catch (err) {
          return JSON.stringify({ success: false, error: err instanceof ServiceError ? err.message : "Invalid email parameters" });
        }
        const { to, subject, body } = validated;
        const mode = args.mode === "draft" ? "draft" : "send";
        const threadId = typeof args.threadId === "string" ? args.threadId : undefined;
        if (mode === "send") {
          try { enforceEmailSendCap(sendCounter); } catch (err) {
            return JSON.stringify({ success: false, error: err instanceof ServiceError ? err.message : "Send limit exceeded" });
          }
        }
        const fingerprint = `${mode}:${to.toLowerCase()}|${subject}|${body}`;
        if (emailQueueFingerprints.has(fingerprint)) {
          return JSON.stringify({ success: true, duplicate: true, message: "Already queued in this request." });
        }
        emailQueueFingerprints.add(fingerprint);
        const item = await queue.enqueueEmail(
          tenantId,
          { mode, email: { to, subject, body, threadId }, title: mode === "draft" ? `Draft: ${subject}` : `Send: ${subject}`, preview: body.slice(0, 240) },
          { origin: "agent" },
        );
        logger.info("agent.stream.email_queued", { tenantId, to, subject, mode, queueItemId: item.id, status: item.status });
        try {
          const contacts = getContactsService();
          await contacts.upsert(tenantId, { email: to, source: "agent" });
          await contacts.touch(tenantId, to);
        } catch { /* best-effort */ }
        const sent = item.status === "approved";
        actions.push({
          kind: "email_queued",
          title: sent ? (mode === "draft" ? "Draft saved" : "Email sent") : (mode === "draft" ? "Draft queued" : "Send queued for approval"),
          detail: `To ${to}`,
          href: sent ? undefined : "/queue",
          disposition: sent ? "sent" : "queued",
          queueItemId: sent ? undefined : item.id,
          lines: [`Subject: ${subject}`, body.slice(0, 400)],
        });
        return JSON.stringify({
          success: true, queueItemId: item.id, status: item.status,
          outcome: sent ? (mode === "draft" ? "draft_saved" : "email_sent") : (mode === "draft" ? "draft_queued" : "email_queued_for_approval"),
          tellUser: sent ? (mode === "draft" ? `Draft saved to Gmail for ${to}.` : `Email sent to ${to} via Gmail.`) : `Email added to Queue for ${to} — user must approve before it sends.`,
        });
      }

      case "queue_calendar_invite": {
        const summary = String(args.summary ?? "").trim();
        const startDateTime = String(args.startDateTime ?? "").trim();
        const endDateTime = String(args.endDateTime ?? "").trim();
        const item = await queue.enqueueCalendarInvite(
          tenantId,
          {
            calendar: { summary, startDateTime, endDateTime,
              description: typeof args.description === "string" ? args.description : undefined,
              location: typeof args.location === "string" ? args.location : undefined,
              timeZone: typeof args.timeZone === "string" ? args.timeZone : undefined,
              attendeeEmails: Array.isArray(args.attendeeEmails) ? args.attendeeEmails.map(String) : undefined,
              recurrence: Array.isArray(args.recurrence) ? args.recurrence.map(String).slice(0, 5) : undefined,
            },
            title: `Invite: ${summary}`,
            preview: `${startDateTime} → ${endDateTime}`,
          },
          { origin: "agent" },
        );
        logger.info("agent.stream.calendar_queued", { tenantId, summary, startDateTime, endDateTime, queueItemId: item.id, status: item.status });
        const sent = item.status === "approved";
        actions.push({
          kind: "calendar_queued",
          title: sent ? "Calendar invite sent" : "Calendar invite queued",
          detail: summary,
          href: sent ? undefined : "/queue",
          disposition: sent ? "sent" : "queued",
          queueItemId: sent ? undefined : item.id,
          lines: [`Start: ${startDateTime}`, `End: ${endDateTime}`],
        });
        return JSON.stringify({
          success: true, queueItemId: item.id, status: item.status,
          outcome: sent ? "calendar_sent" : "calendar_queued_for_approval",
          tellUser: sent ? `Calendar invite "${summary}" was created on Google Calendar.` : `Calendar invite "${summary}" is in Queue — user must approve before it is created.`,
        });
      }

      case "list_queue": {
        const status = args.status === "all" ? "all" : "pending";
        const items = await queue.listItems(tenantId, { status });
        actions.push({ kind: "queue_list", title: status === "pending" ? "Pending queue" : "All queue items", detail: `${items.length} item(s)`, href: "/queue", lines: items.slice(0, 10).map((i) => `${i.kind}: ${i.title}`) });
        return JSON.stringify({ items });
      }

      case "list_calendar_events": {
        const timeMin = String(args.timeMin ?? "");
        const timeMax = String(args.timeMax ?? "");
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 20, 1), 50);
        const result = await calendar.listEvents(tenantId, { timeMin, timeMax, maxResults });
        return JSON.stringify({ events: result.events, count: result.events.length });
      }

      case "approve_queue_item": {
        const itemId = String(args.itemId ?? "").trim();
        if (!itemId) return JSON.stringify({ success: false, error: "itemId is required" });
        const result = await queue.approve(tenantId, itemId);
        actions.push({
          kind: "queue_list",
          title: "Queue item approved",
          detail: result.title,
          href: "/queue",
          lines: [`${result.kind}: ${result.title}`],
        });
        return JSON.stringify({ success: true, itemId, status: result.status });
      }

      case "dismiss_queue_item": {
        const itemId = String(args.itemId ?? "").trim();
        if (!itemId) return JSON.stringify({ success: false, error: "itemId is required" });
        await queue.dismiss(tenantId, itemId);
        actions.push({
          kind: "queue_list",
          title: "Queue item dismissed",
          detail: itemId,
          href: "/queue",
        });
        return JSON.stringify({ success: true, itemId });
      }

      case "list_labels": {
        const labels = await inbox.listLabels(tenantId);
        return JSON.stringify({ labels });
      }

      case "archive_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.archiveThread(tenantId, threadId);
        actions.push({ kind: "thread", title: "Thread archived", detail: threadId, href: "/inbox" });
        return JSON.stringify({ success: true, threadId });
      }

      case "apply_label": {
        const threadId = String(args.threadId ?? "").trim();
        const labelId = String(args.labelId ?? "").trim();
        if (!threadId || !labelId) {
          return JSON.stringify({ success: false, error: "threadId and labelId are required" });
        }
        await inbox.applyLabel(tenantId, threadId, labelId);
        actions.push({ kind: "thread", title: "Label applied", detail: `${labelId} on ${threadId}`, href: "/inbox" });
        return JSON.stringify({ success: true, threadId, labelId });
      }

      case "remove_label": {
        const threadId = String(args.threadId ?? "").trim();
        const labelId = String(args.labelId ?? "").trim();
        if (!threadId || !labelId) {
          return JSON.stringify({ success: false, error: "threadId and labelId are required" });
        }
        await inbox.removeLabel(tenantId, threadId, labelId);
        actions.push({ kind: "thread", title: "Label removed", detail: `${labelId} from ${threadId}`, href: "/inbox" });
        return JSON.stringify({ success: true, threadId, labelId });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  };

  const systemPrompt = buildSystemPromptFor(input.userEmail, approvalDefaults);
  const messages: OpenAiConversationMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.message.trim() },
  ];

  const { content } = await runOpenAiToolLoop(messages, AGENT_TOOLS, executeTool, {
    maxRounds: 6,
    timeoutMs: 120_000,
    onToken: onTokenDelta,
  });

  return { reply: content, actions };
}
