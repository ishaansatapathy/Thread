/**
 * Thread MCP Server — exposes inbox / queue / agent capabilities as MCP tools
 * over HTTP using the JSON-RPC 2.0 / MCP 2024-11 protocol.
 *
 * Endpoint: POST /mcp
 *
 * Supported methods:
 *   initialize          → server info + capabilities
 *   tools/list          → enumerate all tools
 *   tools/call          → invoke a tool
 *
 * Auth: Bearer token = the user's session cookie value, or an API key in
 * the "Authorization: Bearer <key>" header. We re-use the existing session
 * verification from the tRPC context creator.
 *
 * All tools require a valid session; unauthenticated calls receive the
 * standard MCP error response.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "@repo/logger";
import { getInboxService } from "@repo/services/inbox";
import { getQueueService } from "@repo/services/queue";
import { getCalendarService } from "@repo/services/calendar";
import { rankInboxThreads, isInboxAiConfigured } from "@repo/services/ai/inbox-priority";
import { generateDailyBrief } from "@repo/services/ai/daily-brief";
import { getSmartReplies } from "@repo/services/ai/smart-reply";
import { detectInjectionAttempt, validateAgentEmailArgs, DEFAULT_AGENT_SEND_CAP } from "@repo/services/ai/agent-guard";
import { incrementCounter } from "../metrics";
import { resolveMcpUserId } from "../mcp-auth";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";

const skipInTests = () => process.env.VITEST === "true";

async function applyMcpIpRateLimit(req: Request, res: Response): Promise<boolean> {
  if (skipInTests()) return true;
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const result = await checkDistributedRateLimit(`mcp:ip:${ip}`, 120, 60_000);
  res.setHeader("RateLimit-Limit", "120");
  res.setHeader("RateLimit-Remaining", String(result.remaining));
  if (!result.allowed) {
    res.status(429).json(rpcError(null, -32000, "Too many requests. Please slow down."));
    return false;
  }
  return true;
}

async function applyMcpUserRateLimit(
  req: Request,
  res: Response,
  userId: string,
): Promise<boolean> {
  if (skipInTests()) return true;
  const result = await checkDistributedRateLimit(`mcp:user:${userId}`, 60, 60_000);
  res.setHeader("RateLimit-Limit", "60");
  res.setHeader("RateLimit-Remaining", String(result.remaining));
  if (!result.allowed) {
    res.status(429).json(rpcError(null, -32000, "Too many requests. Please slow down."));
    return false;
  }
  return true;
}

export const mcpRouter = Router();

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Tool registry
// ────────────────────────────────────────────────────────────────────────────

const MCP_TOOLS: McpTool[] = [
  {
    name: "list_inbox",
    description:
      "List recent Gmail inbox threads for the authenticated user. Returns subject, sender, snippet and unread status.",
    inputSchema: {
      type: "object",
      properties: {
        maxResults: {
          type: "number",
          description: "Maximum number of threads to return (1–50, default 20).",
        },
        query: {
          type: "string",
          description: "Optional Gmail search query (e.g. 'from:alice is:unread').",
        },
      },
    },
  },
  {
    name: "search_inbox",
    description: "Full-text search over the inbox using Gmail query syntax.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Gmail search query (e.g. 'subject:invoice from:acme').",
        },
        maxResults: {
          type: "number",
          description: "Maximum results (1–50, default 10).",
        },
      },
    },
  },
  {
    name: "get_thread",
    description:
      "Retrieve the full content of a Gmail thread including all messages and their bodies.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID." },
      },
    },
  },
  {
    name: "list_queue",
    description:
      "List pending items in the human-in-the-loop approval queue (emails and calendar invites awaiting approval).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "approved", "dismissed"],
          description: "Filter by status. Defaults to 'pending'.",
        },
        limit: { type: "number", description: "Max results (1–50, default 10)." },
      },
    },
  },
  {
    name: "approve_queue_item",
    description:
      "Approve a pending queue item. For emails this triggers the actual Gmail send; for calendar invites it creates the event.",
    inputSchema: {
      type: "object",
      required: ["itemId"],
      properties: {
        itemId: { type: "string", description: "Queue item ID to approve." },
      },
    },
  },
  {
    name: "dismiss_queue_item",
    description: "Dismiss (reject) a pending queue item without sending.",
    inputSchema: {
      type: "object",
      required: ["itemId"],
      properties: {
        itemId: { type: "string", description: "Queue item ID to dismiss." },
      },
    },
  },
  {
    name: "get_gmail_connection_status",
    description: "Check whether the user's Gmail account is connected via Corsair.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "rank_inbox",
    description:
      "Rank inbox threads by urgency using AI. Returns thread IDs sorted from most to least urgent. Requires OpenAI to be configured.",
    inputSchema: {
      type: "object",
      properties: {
        maxResults: {
          type: "number",
          description: "Number of threads to rank (1–30, default 20).",
        },
        query: {
          type: "string",
          description: "Optional Gmail query to filter threads before ranking.",
        },
      },
    },
  },
  {
    name: "list_calendar_events",
    description:
      "List upcoming Google Calendar events for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        timeMin: {
          type: "string",
          description: "ISO 8601 start of range (default: now).",
        },
        timeMax: {
          type: "string",
          description: "ISO 8601 end of range (default: 7 days from now).",
        },
        maxResults: {
          type: "number",
          description: "Max events to return (1–50, default 20).",
        },
      },
    },
  },
  {
    name: "queue_email",
    description:
      "Queue an email for human approval. Use mode send for outbound mail; draft to save only.",
    inputSchema: {
      type: "object",
      required: ["to", "subject", "body", "mode"],
      properties: {
        to: { type: "string", description: "Recipient email address." },
        subject: { type: "string", description: "Email subject." },
        body: { type: "string", description: "Plain-text email body." },
        mode: { type: "string", enum: ["send", "draft"], description: "send or draft." },
        threadId: { type: "string", description: "Optional Gmail thread id when replying." },
      },
    },
  },
  {
    name: "queue_calendar_invite",
    description: "Queue a Google Calendar invite for human approval.",
    inputSchema: {
      type: "object",
      required: ["summary", "startDateTime", "endDateTime"],
      properties: {
        summary: { type: "string", description: "Event title." },
        startDateTime: { type: "string", description: "ISO 8601 start datetime." },
        endDateTime: { type: "string", description: "ISO 8601 end datetime." },
        description: { type: "string" },
        location: { type: "string" },
        timeZone: { type: "string", description: "IANA timezone e.g. America/New_York." },
        attendeeEmails: { type: "array", items: { type: "string" } },
        recurrence: {
          type: "array",
          items: { type: "string" },
          description: 'Google RRULE strings e.g. ["RRULE:FREQ=WEEKLY"].',
        },
      },
    },
  },
  {
    name: "list_labels",
    description: "List Gmail labels (system and user-defined). Use before apply_label.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "archive_thread",
    description: "Archive a Gmail thread (remove from inbox). Requires explicit user intent.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: { threadId: { type: "string", description: "Gmail thread ID." } },
    },
  },
  {
    name: "star_thread",
    description: "Star a Gmail thread via Corsair (adds STARRED label). Use to bookmark important emails.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: { threadId: { type: "string", description: "Gmail thread ID." } },
    },
  },
  {
    name: "unstar_thread",
    description: "Remove the star from a Gmail thread via Corsair.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: { threadId: { type: "string", description: "Gmail thread ID." } },
    },
  },
  {
    name: "mark_important",
    description: "Mark a Gmail thread as important via Corsair (adds IMPORTANT label).",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: { threadId: { type: "string", description: "Gmail thread ID." } },
    },
  },
  {
    name: "get_daily_brief",
    description: "Get the AI-generated daily brief: today's priorities, pending replies, meeting insights, risks, and recommended actions. Pulls live data from Corsair Gmail + Calendar.",
    inputSchema: {
      type: "object",
      properties: {
        timeZone: { type: "string", description: "IANA timezone e.g. Asia/Kolkata. Defaults to UTC." },
      },
    },
  },
  {
    name: "get_smart_replies",
    description: "Get 3 AI-generated smart reply suggestions for a Gmail thread. Uses full thread context from Corsair Gmail.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID to generate replies for." },
      },
    },
  },
  {
    name: "apply_label",
    description: "Apply a Gmail label to a thread by label id (use list_labels first).",
    inputSchema: {
      type: "object",
      required: ["threadId", "labelId"],
      properties: {
        threadId: { type: "string" },
        labelId: { type: "string", description: "Gmail label id e.g. STARRED or custom id." },
      },
    },
  },
  {
    name: "remove_label",
    description: "Remove a Gmail label from a thread by label id (use list_labels first).",
    inputSchema: {
      type: "object",
      required: ["threadId", "labelId"],
      properties: {
        threadId: { type: "string" },
        labelId: { type: "string", description: "Gmail label id to remove." },
      },
    },
  },
  {
    name: "trash_thread",
    description: "Move a Gmail thread to trash via Corsair. Use only when user explicitly wants to delete an email.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: { threadId: { type: "string", description: "Gmail thread ID." } },
    },
  },
  {
    name: "delete_draft",
    description: "Permanently delete a Gmail draft by id via Corsair. Use when user wants to discard a draft.",
    inputSchema: {
      type: "object",
      required: ["draftId"],
      properties: { draftId: { type: "string", description: "Gmail draft ID to delete." } },
    },
  },
];

const MCP_SERVER_VERSION = "1.2.0";

// ────────────────────────────────────────────────────────────────────────────
// JSON-RPC helpers
// ────────────────────────────────────────────────────────────────────────────

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(content: unknown) {
  return {
    content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tool executor
// ────────────────────────────────────────────────────────────────────────────

async function callTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const inbox = getInboxService();
  const queue = getQueueService();
  const calendar = getCalendarService();

  incrementCounter(`mcp.tool.${name}`);

  switch (name) {
    case "list_inbox": {
      const maxResults = Math.min(Number(args.maxResults ?? 20), 50);
      const query = typeof args.query === "string" ? args.query : undefined;
      const result = await inbox.listThreads(userId, { maxResults, query });
      const summary = result.threads.map((t) => ({
        id: t.id,
        subject: t.subject ?? "(no subject)",
        from: t.fromName ?? t.from ?? "Unknown",
        snippet: t.snippet?.slice(0, 120),
        unread: t.unread,
        date: t.date,
      }));
      return toolResult(summary);
    }

    case "search_inbox": {
      const query = String(args.query ?? "");
      const maxResults = Math.min(Number(args.maxResults ?? 10), 50);
      const result = await inbox.listThreads(userId, { maxResults, query });
      const summary = result.threads.map((t) => ({
        id: t.id,
        subject: t.subject ?? "(no subject)",
        from: t.fromName ?? t.from ?? "Unknown",
        snippet: t.snippet?.slice(0, 120),
        unread: t.unread,
        date: t.date,
      }));
      return toolResult(summary);
    }

    case "get_thread": {
      const threadId = String(args.threadId ?? "");
      const thread = await inbox.getThread(userId, threadId);
      if (!thread) return toolResult({ error: "Thread not found" });
      return toolResult(thread);
    }

    case "list_queue": {
      const status = (args.status as string | undefined) ?? "pending";
      const limit = Math.min(Number(args.limit ?? 10), 50);
      const items = await queue.listItems(userId, {
        status: status as "pending" | "approved" | "dismissed",
        limit,
      });
      return toolResult(
        items.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          preview: item.preview,
          status: item.status,
          createdAt: item.createdAt,
        })),
      );
    }

    case "approve_queue_item": {
      const itemId = String(args.itemId ?? "");
      const result = await queue.approve(userId, itemId);
      return toolResult({ ok: true, itemId, status: result.status });
    }

    case "dismiss_queue_item": {
      const itemId = String(args.itemId ?? "");
      await queue.dismiss(userId, itemId);
      return toolResult({ ok: true, itemId });
    }

    case "get_gmail_connection_status": {
      const status = await inbox.getConnectionStatus(userId);
      return toolResult(status);
    }

    case "rank_inbox": {
      const maxResults = Math.min(Number(args.maxResults ?? 20), 30);
      const query = typeof args.query === "string" ? args.query : undefined;
      if (!isInboxAiConfigured()) {
        return toolResult({ error: "OpenAI is not configured. Set OPENAI_API_KEY to enable AI ranking." });
      }
      const result = await inbox.listThreads(userId, { maxResults, query });
      const threads = result.threads.map((t) => ({
        id: t.id,
        snippet: t.snippet ?? "",
        subject: t.subject,
        from: t.fromName ?? t.from,
      }));
      const rankedIds = await rankInboxThreads(threads);
      const threadMap = new Map(result.threads.map((t) => [t.id, t]));
      return toolResult(
        rankedIds.map((id) => {
          const t = threadMap.get(id);
          return { id, subject: t?.subject ?? "(no subject)", from: t?.fromName ?? t?.from ?? "Unknown", snippet: t?.snippet?.slice(0, 100) };
        }),
      );
    }

    case "list_calendar_events": {
      const now = new Date();
      const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const timeMin = typeof args.timeMin === "string" ? args.timeMin : now.toISOString();
      const timeMax = typeof args.timeMax === "string" ? args.timeMax : weekAhead.toISOString();
      const maxResults = Math.min(Number(args.maxResults ?? 20), 50);
      const result = await calendar.listEvents(userId, { timeMin, timeMax, maxResults });
      return toolResult(
        result.events.map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start,
          end: e.end,
          location: e.location,
          attendees: e.attendees?.length ?? 0,
          htmlLink: e.htmlLink,
        })),
      );
    }

    case "queue_email": {
      let validated: { to: string; subject: string; body: string };
      try {
        validated = validateAgentEmailArgs(args);
      } catch (err) {
        return toolResult({
          success: false,
          error: err instanceof Error ? err.message : "Invalid email parameters",
        });
      }
      const injection = detectInjectionAttempt(`${validated.subject}\n${validated.body}`);
      if (injection.flagged) {
        return toolResult({ success: false, error: injection.reason });
      }
      const mode = args.mode === "draft" ? "draft" : "send";
      if (mode === "send") {
        const cap = await checkDistributedRateLimit(
          `mcp:email_send:${userId}`,
          DEFAULT_AGENT_SEND_CAP,
          60_000,
        );
        if (!cap.allowed) {
          return toolResult({
            success: false,
            error: `MCP send limit reached (max ${DEFAULT_AGENT_SEND_CAP} send emails per minute). Use draft mode or wait.`,
          });
        }
      }
      const threadId = typeof args.threadId === "string" ? args.threadId : undefined;
      const item = await queue.enqueueEmail(
        userId,
        {
          mode,
          email: { ...validated, threadId },
          title: mode === "draft" ? `Draft: ${validated.subject}` : `Send: ${validated.subject}`,
          preview: validated.body.slice(0, 240),
        },
        { origin: "agent" },
      );
      return toolResult({ success: true, queueItemId: item.id, status: item.status });
    }

    case "queue_calendar_invite": {
      const summary = String(args.summary ?? "").trim();
      const startDateTime = String(args.startDateTime ?? "").trim();
      const endDateTime = String(args.endDateTime ?? "").trim();
      if (!summary || !startDateTime || !endDateTime) {
        return toolResult({ success: false, error: "summary, startDateTime, and endDateTime are required" });
      }
      const item = await queue.enqueueCalendarInvite(
        userId,
        {
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
            recurrence: Array.isArray(args.recurrence)
              ? args.recurrence.map(String).slice(0, 5)
              : undefined,
          },
          title: `Invite: ${summary}`,
          preview: `${startDateTime} → ${endDateTime}`,
        },
        { origin: "agent" },
      );
      return toolResult({ success: true, queueItemId: item.id, status: item.status });
    }

    case "list_labels": {
      const labels = await inbox.listLabels(userId);
      return toolResult(labels);
    }

    case "archive_thread": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      await inbox.archiveThread(userId, threadId);
      return toolResult({ success: true, threadId });
    }

    case "star_thread": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      await inbox.starThread(userId, threadId);
      return toolResult({ success: true, threadId, action: "starred" });
    }

    case "unstar_thread": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      await inbox.unstarThread(userId, threadId);
      return toolResult({ success: true, threadId, action: "unstarred" });
    }

    case "mark_important": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      await inbox.markImportant(userId, threadId);
      return toolResult({ success: true, threadId, action: "marked_important" });
    }

    case "get_daily_brief": {
      const timeZone = typeof args.timeZone === "string" ? args.timeZone : "UTC";
      const brief = await generateDailyBrief({ tenantId: userId, timeZone });
      return toolResult(brief);
    }

    case "get_smart_replies": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      const result = await getSmartReplies({ tenantId: userId, threadId });
      return toolResult(result);
    }

    case "apply_label": {
      const threadId = String(args.threadId ?? "").trim();
      const labelId = String(args.labelId ?? "").trim();
      if (!threadId || !labelId) {
        return toolResult({ success: false, error: "threadId and labelId are required" });
      }
      await inbox.applyLabel(userId, threadId, labelId);
      return toolResult({ success: true, threadId, labelId });
    }

    case "remove_label": {
      const threadId = String(args.threadId ?? "").trim();
      const labelId = String(args.labelId ?? "").trim();
      if (!threadId || !labelId) {
        return toolResult({ success: false, error: "threadId and labelId are required" });
      }
      await inbox.removeLabel(userId, threadId, labelId);
      return toolResult({ success: true, threadId, labelId });
    }

    case "trash_thread": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      await inbox.trashThread(userId, threadId);
      return toolResult({ success: true, threadId, action: "trashed" });
    }

    case "delete_draft": {
      const draftId = String(args.draftId ?? "").trim();
      if (!draftId) return toolResult({ success: false, error: "draftId is required" });
      await inbox.deleteDraft(userId, draftId);
      return toolResult({ success: true, draftId, action: "deleted" });
    }

    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Route handler
// ────────────────────────────────────────────────────────────────────────────

mcpRouter.get("/", (_req: Request, res: Response) => {
  return res.json({
    name: "thread-mcp",
    version: MCP_SERVER_VERSION,
    description: "Thread MCP server — Gmail inbox + approval queue tools for AI assistants",
    protocol: "MCP 2024-11 / JSON-RPC 2.0",
    endpoint: "/mcp",
    tools: MCP_TOOLS.map((t) => t.name),
  });
});

mcpRouter.post("/", async (req: Request, res: Response) => {
  const body = req.body as JsonRpcRequest;

  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return res
      .status(400)
      .json(rpcError(body?.id ?? null, -32600, "Invalid JSON-RPC request"));
  }

  const id = body.id ?? null;
  const method = body.method;

  // Throttle unauthenticated discovery traffic by IP only (never trust client user headers).
  const publicMethods = new Set(["initialize", "tools/list", "notifications/initialized"]);
  if (publicMethods.has(method)) {
    const ipLimitOk = await applyMcpIpRateLimit(req, res);
    if (!ipLimitOk) return;
  }

  try {
    if (method === "initialize") {
      return res.json(
        ok(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "thread-mcp", version: MCP_SERVER_VERSION },
        }),
      );
    }

    if (method === "tools/list") {
      return res.json(ok(id, { tools: MCP_TOOLS }));
    }

    // notifications/initialized — no-op acknowledgment per MCP spec
    if (method === "notifications/initialized") {
      return res.status(200).send();
    }

    if (method === "tools/call") {
      const params = (body.params ?? {}) as Record<string, unknown>;
      const toolName = String(params.name ?? "");
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

      const userId = await resolveMcpUserId(req);
      if (!userId) {
        return res.status(401).json(rpcError(id, -32001, "Authentication required"));
      }

      const userLimitOk = await applyMcpUserRateLimit(req, res, userId);
      if (!userLimitOk) return;

      const result = await callTool(toolName, toolArgs, userId);
      return res.json(ok(id, result));
    }

    return res.status(404).json(rpcError(id, -32601, `Method not found: ${method}`));
  } catch (error) {
    const code = (error as { code?: number }).code ?? -32603;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("MCP tool call failed", { method, error: message });
    return res.status(500).json(rpcError(id, code, message));
  }
});
