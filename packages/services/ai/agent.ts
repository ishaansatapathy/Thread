import { getCalendarService } from "../calendar";
import { ServiceError } from "../errors";
import { getInboxService } from "../inbox";
import { getQueueService } from "../queue";
import { isOpenAiConfigured } from "./openai";
import { rankInboxThreads } from "./inbox-priority";
import type { OpenAiConversationMessage, OpenAiToolDefinition } from "./openai-tools";
import { runOpenAiToolLoop } from "./openai-tools";

export type AgentHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentActionCard = {
  kind: "email_queued" | "calendar_queued" | "inbox_search" | "inbox_ranked" | "queue_list" | "thread";
  title: string;
  detail?: string;
  href?: string;
  lines?: string[];
};

export type AgentChatResult = {
  reply: string;
  actions: AgentActionCard[];
};

const AGENT_TOOLS: OpenAiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_inbox",
      description: "Search or list Gmail inbox threads. Omit query to list recent INBOX threads.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query (from:, subject:, etc.)" },
          maxResults: { type: "number", description: "Max threads, 1-25", default: 10 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_thread",
      description: "Fetch a single email thread with messages for context before drafting a reply.",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Gmail thread id" },
        },
        required: ["threadId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rank_inbox",
      description: "Rank inbox threads by urgency using AI. Fetches recent inbox first.",
      parameters: {
        type: "object",
        properties: {
          maxResults: { type: "number", description: "Threads to rank, 1-25", default: 15 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_email",
      description:
        "Queue an email for human approval. NEVER sends directly. Use mode send for outbound mail the user asked to send; draft to save only.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Plain-text email body" },
          mode: { type: "string", enum: ["send", "draft"], description: "send = queue for approval to send" },
          threadId: { type: "string", description: "Optional Gmail thread id when replying" },
        },
        required: ["to", "subject", "body", "mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_calendar_invite",
      description: "Queue a Google Calendar invite for human approval. Never creates the event directly.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title" },
          startDateTime: { type: "string", description: "ISO 8601 start datetime" },
          endDateTime: { type: "string", description: "ISO 8601 end datetime" },
          description: { type: "string" },
          location: { type: "string" },
          attendeeEmails: { type: "array", items: { type: "string" } },
          timeZone: { type: "string", description: "IANA timezone e.g. Asia/Kolkata" },
        },
        required: ["summary", "startDateTime", "endDateTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_queue",
      description: "List pending (or all) approval queue items.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "all"], default: "pending" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_calendar_events",
      description: "List calendar events in a date range to find free slots or context.",
      parameters: {
        type: "object",
        properties: {
          timeMin: { type: "string", description: "ISO 8601 range start" },
          timeMax: { type: "string", description: "ISO 8601 range end" },
          maxResults: { type: "number", default: 20 },
        },
        required: ["timeMin", "timeMax"],
      },
    },
  },
];

function buildSystemPrompt(userEmail?: string) {
  return [
    "You are Thread Agent — an assistant for Gmail and Google Calendar inside the Thread app.",
    "CRITICAL: You cannot send email or create calendar events directly. Always use queue_email or queue_calendar_invite.",
    "After queueing, tell the user to review and Approve in the Queue tab.",
    "When the user asks to send mail to someone with a topic (e.g. sick leave on certain dates), write a professional plain-text email and queue it with mode send.",
    "Use search_inbox / get_thread before drafting replies to existing threads.",
    "Be concise and friendly. Confirm what you queued with to/subject preview.",
    userEmail ? `The signed-in user's email is ${userEmail}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function threadLine(thread: {
  id: string;
  subject?: string;
  from?: string;
  fromName?: string;
  snippet: string;
  date?: string;
}) {
  const sender = thread.fromName?.trim() || thread.from?.trim() || "Unknown";
  return `${thread.id} | ${sender} | ${thread.subject?.trim() || "No subject"} | ${thread.snippet.slice(0, 120)}`;
}

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

  const inbox = getInboxService();
  const queue = getQueueService();
  const calendar = getCalendarService();
  const actions: AgentActionCard[] = [];

  const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "search_inbox": {
        const query = typeof args.query === "string" ? args.query.trim() : undefined;
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 10, 1), 25);
        const result = await inbox.listThreads(tenantId, { maxResults, query });
        const lines = result.threads.map(threadLine);
        actions.push({
          kind: "inbox_search",
          title: query ? `Search: ${query}` : "Recent inbox",
          detail: `${result.threads.length} thread(s)`,
          href: query ? `/inbox?focus=search` : "/inbox",
          lines: lines.slice(0, 8),
        });
        return JSON.stringify({ threads: result.threads, count: result.threads.length });
      }

      case "get_thread": {
        const threadId = String(args.threadId ?? "");
        const thread = await inbox.getThread(tenantId, threadId, { userEmail: input.userEmail });
        if (!thread) {
          return JSON.stringify({ error: "Thread not found" });
        }
        actions.push({
          kind: "thread",
          title: thread.subject?.trim() || "Thread",
          detail: thread.fromName || thread.from,
          href: `/inbox`,
          lines: (thread.messages ?? []).slice(0, 5).map((m) => `${m.from ?? "?"}: ${m.body.slice(0, 200)}`),
        });
        return JSON.stringify({ thread });
      }

      case "rank_inbox": {
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 15, 1), 25);
        const listed = await inbox.listThreads(tenantId, { maxResults });
        const rankedIds = await rankInboxThreads(
          listed.threads.map((t) => ({
            id: t.id,
            snippet: t.snippet,
            subject: t.subject,
            from: t.fromName ?? t.from,
          })),
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
        const to = String(args.to ?? "").trim();
        const subject = String(args.subject ?? "").trim();
        const body = String(args.body ?? "").trim();
        const mode = args.mode === "draft" ? "draft" : "send";
        const threadId = typeof args.threadId === "string" ? args.threadId : undefined;
        const item = await queue.enqueueEmail(tenantId, {
          mode,
          email: { to, subject, body, threadId },
          title: mode === "draft" ? `Draft: ${subject}` : `Send: ${subject}`,
          preview: body.slice(0, 240),
        });
        actions.push({
          kind: "email_queued",
          title: mode === "draft" ? "Draft queued" : "Send queued for approval",
          detail: `To ${to}`,
          href: "/queue",
          lines: [`Subject: ${subject}`, body.slice(0, 400)],
        });
        return JSON.stringify({ success: true, queueItemId: item.id, status: "pending" });
      }

      case "queue_calendar_invite": {
        const summary = String(args.summary ?? "").trim();
        const startDateTime = String(args.startDateTime ?? "").trim();
        const endDateTime = String(args.endDateTime ?? "").trim();
        const item = await queue.enqueueCalendarInvite(tenantId, {
          calendar: {
            summary,
            startDateTime,
            endDateTime,
            description: typeof args.description === "string" ? args.description : undefined,
            location: typeof args.location === "string" ? args.location : undefined,
            timeZone: typeof args.timeZone === "string" ? args.timeZone : undefined,
            attendeeEmails: Array.isArray(args.attendeeEmails)
              ? args.attendeeEmails.map(String)
              : undefined,
          },
          title: `Invite: ${summary}`,
          preview: `${startDateTime} → ${endDateTime}`,
        });
        actions.push({
          kind: "calendar_queued",
          title: "Calendar invite queued",
          detail: summary,
          href: "/queue",
          lines: [`Start: ${startDateTime}`, `End: ${endDateTime}`],
        });
        return JSON.stringify({ success: true, queueItemId: item.id, status: "pending" });
      }

      case "list_queue": {
        const status = args.status === "all" ? "all" : "pending";
        const items = await queue.listItems(tenantId, { status });
        actions.push({
          kind: "queue_list",
          title: status === "pending" ? "Pending queue" : "All queue items",
          detail: `${items.length} item(s)`,
          href: "/queue",
          lines: items.slice(0, 10).map((i) => `${i.kind}: ${i.title}`),
        });
        return JSON.stringify({ items });
      }

      case "list_calendar_events": {
        const timeMin = String(args.timeMin ?? "");
        const timeMax = String(args.timeMax ?? "");
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 20, 1), 50);
        const result = await calendar.listEvents(tenantId, { timeMin, timeMax, maxResults });
        return JSON.stringify({ events: result.events, count: result.events.length });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  };

  const history = input.history ?? [];
  const messages: OpenAiConversationMessage[] = [
    { role: "system", content: buildSystemPrompt(input.userEmail) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.message.trim() },
  ];

  const { content } = await runOpenAiToolLoop(messages, AGENT_TOOLS, executeTool);

  return {
    reply: content,
    actions,
  };
}
