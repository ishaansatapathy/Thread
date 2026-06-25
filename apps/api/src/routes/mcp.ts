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
import { analyzeInboxThreads, isInboxAiConfigured } from "@repo/services/ai/inbox-priority";
import { generateDailyBrief } from "@repo/services/ai/daily-brief";
import { getSmartReplies } from "@repo/services/ai/smart-reply";
import { getMeetingPrep } from "@repo/services/ai/meeting-prep";
import { getThreadContext } from "@repo/services/ai/thread-context";
import { getMissedFollowUps } from "@repo/services/ai/missed-followups";
import { getContactIntel } from "@repo/services/ai/contact-intel";
import { summarizeThread } from "@repo/services/ai/summarize-thread";
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
      "Analyze inbox threads with AI: urgency tier, 0-100 score, one-line reason, and category per thread. Returns rankedIds, items, and summary counts.",
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
      "List or search Google Calendar events. Pass query to filter by title when finding a meeting to delete or reschedule.",
    inputSchema: {
      type: "object",
      properties: {
        timeMin: {
          type: "string",
          description: "ISO 8601 start of range (default: 30 days ago).",
        },
        timeMax: {
          type: "string",
          description: "ISO 8601 end of range (default: 90 days ahead).",
        },
        maxResults: {
          type: "number",
          description: "Max events to return (1–50, default 20).",
        },
        query: {
          type: "string",
          description: "Free-text search on event title/summary.",
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
  {
    name: "get_meeting_prep",
    description: "Generate AI meeting preparation for a calendar event: past email context, agenda items, talking points, and risks. Fetches event via Corsair Calendar and related emails via Corsair Gmail.",
    inputSchema: {
      type: "object",
      required: ["eventId"],
      properties: {
        eventId: { type: "string", description: "Google Calendar event ID." },
        timeZone: { type: "string", description: "IANA timezone e.g. Asia/Kolkata. Defaults to UTC." },
      },
    },
  },
  {
    name: "get_thread_context",
    description: "Generate a smart context summary for an email thread: key people, action items, related emails, and sentiment. Fetches via Corsair Gmail and synthesizes with OpenAI.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID." },
      },
    },
  },
  {
    name: "get_missed_followups",
    description: "Detect past meetings that had no follow-up email sent. Cross-references Corsair Calendar events with Corsair Gmail sent messages and suggests follow-up drafts.",
    inputSchema: {
      type: "object",
      properties: {
        timeZone: { type: "string", description: "IANA timezone e.g. Asia/Kolkata." },
      },
    },
  },
  {
    name: "check_free_busy",
    description: "Check free/busy availability for a time range via Corsair Calendar freebusy API. Returns conflicting events and available windows.",
    inputSchema: {
      type: "object",
      required: ["startDateTime", "endDateTime"],
      properties: {
        startDateTime: { type: "string", description: "ISO 8601 start datetime." },
        endDateTime: { type: "string", description: "ISO 8601 end datetime." },
        timeZone: { type: "string", description: "IANA timezone e.g. Asia/Kolkata." },
      },
    },
  },
  {
    name: "respond_to_event",
    description: "Accept, decline, or tentatively accept a Google Calendar event invitation via Corsair. Updates attendee RSVP status directly on Google Calendar.",
    inputSchema: {
      type: "object",
      required: ["eventId", "response"],
      properties: {
        eventId: { type: "string", description: "Google Calendar event ID." },
        response: { type: "string", enum: ["accepted", "declined", "tentative"], description: "RSVP response." },
      },
    },
  },
  {
    name: "reschedule_event",
    description: "Queue a calendar reschedule for human approval (HITL). Creates a calendar_archive queue item — approve in Queue to apply new times via Corsair.",
    inputSchema: {
      type: "object",
      required: ["eventId", "startDateTime", "endDateTime"],
      properties: {
        eventId: { type: "string", description: "Google Calendar event ID." },
        startDateTime: { type: "string", description: "New ISO 8601 start datetime." },
        endDateTime: { type: "string", description: "New ISO 8601 end datetime." },
        timeZone: { type: "string", description: "IANA timezone e.g. Asia/Kolkata." },
      },
    },
  },
  {
    name: "cancel_event",
    description: "Queue cancellation of a Google Calendar event for human approval (HITL). Notifies attendees on approve via Corsair cancel — use dismiss to abort.",
    inputSchema: {
      type: "object",
      required: ["eventId"],
      properties: {
        eventId: { type: "string", description: "Google Calendar event ID to cancel." },
      },
    },
  },
  {
    name: "list_drafts",
    description: "List Gmail draft emails via Corsair Gmail API.",
    inputSchema: {
      type: "object",
      properties: {
        maxResults: { type: "number", description: "Max drafts to return (1-25).", default: 10 },
      },
    },
  },
  {
    name: "get_draft",
    description: "Fetch a specific Gmail draft by ID via Corsair Gmail API, including full message content.",
    inputSchema: {
      type: "object",
      required: ["draftId"],
      properties: {
        draftId: { type: "string", description: "Gmail draft ID." },
      },
    },
  },
  {
    name: "mark_thread_read",
    description: "Mark a Gmail thread as read via Corsair Gmail API (removes UNREAD label).",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID." },
      },
    },
  },
  {
    name: "get_contact_intel",
    description: "Get relationship intelligence for an email contact: interaction history, response rate, last contact date, and key topics — all fetched from Corsair Gmail and analyzed by OpenAI.",
    inputSchema: {
      type: "object",
      required: ["email"],
      properties: {
        email: { type: "string", description: "Contact email address." },
        name: { type: "string", description: "Contact display name (optional)." },
      },
    },
  },
  {
    name: "summarize_thread",
    description: "Generate an AI summary of an email thread: key decisions, action items, and next steps. Fetches full thread via Corsair Gmail and summarizes with OpenAI.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID." },
      },
    },
  },
  // ── 5 new tools (39 total) ──────────────────────────────────────────────────
  {
    name: "mark_not_important",
    description: "Remove the Important flag from a Gmail thread via Corsair (removes IMPORTANT label).",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID." },
      },
    },
  },
  {
    name: "get_calendar_event",
    description: "Fetch full details of a single Google Calendar event by ID via Corsair: title, time, location, attendees, description.",
    inputSchema: {
      type: "object",
      required: ["eventId"],
      properties: {
        eventId: { type: "string", description: "Google Calendar event ID." },
      },
    },
  },
  {
    name: "find_meeting_slots",
    description: "Find available meeting slots by querying the user's Corsair Calendar free/busy. Returns up to 5 concrete slot suggestions with human-readable labels.",
    inputSchema: {
      type: "object",
      required: ["durationMinutes"],
      properties: {
        durationMinutes: { type: "number", description: "Meeting duration in minutes (e.g. 30, 60)." },
        preferredStartDate: { type: "string", description: "ISO datetime to start searching from (default: today)." },
        preferredEndDate: { type: "string", description: "ISO datetime to stop searching (default: +7 days)." },
        timeZone: { type: "string", description: "IANA timezone e.g. Asia/Kolkata." },
        attendeeEmail: { type: "string", description: "Optional attendee email for context." },
        context: { type: "string", description: "Meeting context e.g. '1:1 with Rahul'." },
      },
    },
  },
  {
    name: "create_draft_email",
    description: "Save an email as a Gmail draft via Corsair. Does NOT send or queue — creates a real Gmail draft the user can review and send from Gmail.",
    inputSchema: {
      type: "object",
      required: ["to", "subject", "body"],
      properties: {
        to: { type: "string", description: "Recipient email address." },
        subject: { type: "string", description: "Email subject." },
        body: { type: "string", description: "Plain-text email body." },
        threadId: { type: "string", description: "Optional Gmail thread ID (for drafting a reply)." },
        cc: { type: "string", description: "Optional CC email address." },
        bcc: { type: "string", description: "Optional BCC email address." },
      },
    },
  },
  {
    name: "update_event_details",
    description: "Queue an update to the title, description, or location of a Google Calendar event for human approval (HITL). Creates a calendar_update queue item — approve in Queue to apply via Corsair patch API. For time changes use reschedule_event.",
    inputSchema: {
      type: "object",
      required: ["eventId"],
      properties: {
        eventId: { type: "string", description: "Google Calendar event ID." },
        summary: { type: "string", description: "New event title." },
        description: { type: "string", description: "New event description." },
        location: { type: "string", description: "New event location." },
      },
    },
  },
  {
    name: "get_calendar_connection_status",
    description: "Check whether Google Calendar is connected for the current user. Returns googlecalendar connection state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mark_thread_unread",
    description: "Add the UNREAD label to a Gmail thread via Corsair — the reverse of mark_thread_read. Useful for flagging threads that need revisiting.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID." },
      },
    },
  },
  {
    name: "quick_add_event",
    description: "Parse natural-language text locally and queue a calendar invite for approval (events.create on approve). E.g. 'Lunch with Sarah tomorrow at noon'.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Natural-language event description, e.g. 'Team standup every weekday at 10am'." },
      },
    },
  },
  {
    name: "send_draft",
    description: "Queue sending an existing Gmail draft for approval. On approve, Corsair drafts.send runs via Gmail.",
    inputSchema: {
      type: "object",
      required: ["draftId"],
      properties: {
        draftId: { type: "string", description: "Gmail draft ID to send." },
      },
    },
  },
  {
    name: "mute_thread",
    description: "Mute a Gmail thread via Corsair (adds MUTE label, removes from INBOX). Future messages in this thread will skip the inbox. Useful for silencing noisy threads without archiving.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID to mute." },
      },
    },
  },
  {
    name: "unmute_thread",
    description: "Unmute a Gmail thread via Corsair (removes MUTE label, restores to INBOX). Reverses a previous mute_thread action.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Gmail thread ID to unmute." },
      },
    },
  },
  {
    name: "update_draft",
    description: "Update an existing Gmail draft via Corsair drafts.update.",
    inputSchema: {
      type: "object",
      required: ["draftId", "to", "subject", "body"],
      properties: {
        draftId: { type: "string" },
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        threadId: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
      },
    },
  },
  {
    name: "batch_modify_threads",
    description: "Bulk add/remove Gmail labels on multiple threads via Corsair messages.batchModify.",
    inputSchema: {
      type: "object",
      required: ["threadIds"],
      properties: {
        threadIds: { type: "array", items: { type: "string" } },
        addLabelIds: { type: "array", items: { type: "string" } },
        removeLabelIds: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "list_messages",
    description: "List Gmail messages via Corsair messages.list with optional query and label filters.",
    inputSchema: {
      type: "object",
      properties: {
        maxResults: { type: "number" },
        q: { type: "string" },
        labelIds: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "modify_message",
    description: "Add or remove labels on a single Gmail message via Corsair messages.modify.",
    inputSchema: {
      type: "object",
      required: ["messageId"],
      properties: {
        messageId: { type: "string" },
        addLabelIds: { type: "array", items: { type: "string" } },
        removeLabelIds: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "delete_thread",
    description: "Permanently delete a Gmail thread via Corsair threads.delete.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: { threadId: { type: "string" } },
    },
  },
  {
    name: "untrash_thread",
    description: "Restore a Gmail thread from trash via Corsair threads.untrash.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: { threadId: { type: "string" } },
    },
  },
  {
    name: "search_threads_db",
    description: "Search synced Gmail threads via corsair.gmail.db.threads.search (local Corsair DB cache).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
    },
  },
  {
    name: "search_messages_db",
    description: "Search synced Gmail messages via corsair.gmail.db.messages.search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        from: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
    },
  },
  {
    name: "search_events_db",
    description: "Search synced Google Calendar events via googlecalendar.db.events.search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
    },
  },
  {
    name: "search_calendars_db",
    description: "Search synced Google Calendars via googlecalendar.db.calendars.search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
    },
  },
  {
    name: "search_drafts_db",
    description: "Search synced Gmail drafts via corsair.gmail.db.drafts.search (local Corsair DB cache).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        offset: { type: "number" },
      },
    },
  },
  {
    name: "search_labels_db",
    description: "Search synced Gmail labels via corsair.gmail.db.labels.search (local Corsair DB cache).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Filter labels whose name contains this text." },
        limit: { type: "number" },
        offset: { type: "number" },
      },
    },
  },
];

const MCP_SERVER_VERSION = "2.5.0";

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
      const analysis = await analyzeInboxThreads(threads);
      const threadMap = new Map(result.threads.map((t) => [t.id, t]));
      return toolResult({
        ...analysis,
        threads: analysis.items.map((item) => {
          const t = threadMap.get(item.id);
          return {
            ...item,
            subject: t?.subject ?? "(no subject)",
            from: t?.fromName ?? t?.from ?? "Unknown",
            snippet: t?.snippet?.slice(0, 100),
          };
        }),
      });
    }

    case "list_calendar_events": {
      const now = new Date();
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const threeMonthsAhead = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      const timeMin = typeof args.timeMin === "string" ? args.timeMin : monthAgo.toISOString();
      const timeMax = typeof args.timeMax === "string" ? args.timeMax : threeMonthsAhead.toISOString();
      const maxResults = Math.min(Number(args.maxResults ?? 20), 50);
      const query = typeof args.query === "string" ? args.query.trim() : undefined;
      const result = await calendar.listEvents(userId, {
        timeMin,
        timeMax,
        maxResults,
        ...(query ? { q: query } : {}),
      });
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

    case "get_meeting_prep": {
      const eventId = String(args.eventId ?? "").trim();
      const timeZone = String(args.timeZone ?? "UTC").trim();
      if (!eventId) return toolResult({ success: false, error: "eventId is required" });
      const prep = await getMeetingPrep({ tenantId: userId, eventId, timeZone });
      return toolResult(prep);
    }

    case "get_thread_context": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      const ctx = await getThreadContext({ tenantId: userId, threadId });
      return toolResult(ctx);
    }

    case "get_missed_followups": {
      const timeZone = String(args.timeZone ?? "UTC").trim();
      const followups = await getMissedFollowUps({ tenantId: userId, timeZone });
      return toolResult({ followups, count: followups.length });
    }

    case "check_free_busy": {
      const startDateTime = String(args.startDateTime ?? "").trim();
      const endDateTime = String(args.endDateTime ?? "").trim();
      const timeZone = String(args.timeZone ?? "UTC").trim();
      if (!startDateTime || !endDateTime) {
        return toolResult({ success: false, error: "startDateTime and endDateTime are required" });
      }
      const calendar = getCalendarService();
      const result = await calendar.checkFreeBusy(userId, { startDateTime, endDateTime, timeZone });
      return toolResult(result);
    }

    case "respond_to_event": {
      const eventId = String(args.eventId ?? "").trim();
      const responseRaw = String(args.response ?? "").trim().toLowerCase();
      const response = responseRaw as "accepted" | "declined" | "tentative";
      if (!eventId || !["accepted", "declined", "tentative"].includes(response)) {
        return toolResult({ success: false, error: "eventId and response (accepted/declined/tentative) are required" });
      }
      const calendar = getCalendarService();
      const updated = await calendar.respondToEvent(userId, eventId, response);
      return toolResult({ success: true, eventId, response, event: updated });
    }

    case "reschedule_event": {
      const eventId = String(args.eventId ?? "").trim();
      const startDateTime = String(args.startDateTime ?? "").trim();
      const endDateTime = String(args.endDateTime ?? "").trim();
      const timeZone = String(args.timeZone ?? "UTC").trim();
      if (!eventId || !startDateTime || !endDateTime) {
        return toolResult({ success: false, error: "eventId, startDateTime, and endDateTime are required" });
      }
      const existing = await calendar.getEvent(userId, eventId);
      if (!existing) return toolResult({ success: false, error: "Event not found" });
      const item = await queue.enqueueCalendarArchive(
        userId,
        {
          archive: {
            eventId,
            summary: existing.summary ?? "Event",
            startDateTime,
            endDateTime,
            timeZone,
            htmlLink: existing.htmlLink,
            recurringEventId: existing.recurringEventId,
          },
          title: `Reschedule: ${existing.summary ?? "Event"}`,
        },
        { origin: "agent" },
      );
      return toolResult({
        success: true,
        queued: true,
        queueItemId: item.id,
        status: item.status,
        message: "Reschedule queued — approve via approve_queue_item or /queue",
      });
    }

    case "cancel_event": {
      const eventId = String(args.eventId ?? "").trim();
      if (!eventId) return toolResult({ success: false, error: "eventId is required" });
      const existing = await calendar.getEvent(userId, eventId);
      const item = await queue.enqueueCalendarDelete(
        userId,
        {
          delete: {
            eventId,
            summary: existing?.summary ?? "Event",
            htmlLink: existing?.htmlLink,
            recurringEventId: existing?.recurringEventId,
            cancelWithNotify: true,
          },
          title: `Cancel: ${existing?.summary ?? eventId}`,
        },
        { origin: "agent" },
      );
      return toolResult({
        success: true,
        queued: true,
        queueItemId: item.id,
        status: item.status,
        message: "Cancellation queued — approve via approve_queue_item or /queue",
      });
    }

    case "list_drafts": {
      const maxResults = Math.min(25, Math.max(1, Number(args.maxResults ?? 10)));
      const result = await inbox.listDrafts(userId, { maxResults });
      return toolResult(result);
    }

    case "get_draft": {
      const draftId = String(args.draftId ?? "").trim();
      if (!draftId) return toolResult({ success: false, error: "draftId is required" });
      const draft = await inbox.getDraft(userId, draftId);
      if (!draft) return toolResult({ success: false, error: "Draft not found" });
      return toolResult(draft);
    }

    case "mark_thread_read": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      await inbox.markThreadRead(userId, threadId);
      return toolResult({ success: true, threadId, action: "marked_read" });
    }

    case "get_contact_intel": {
      const email = String(args.email ?? "").trim();
      const name = args.name ? String(args.name).trim() : undefined;
      if (!email) return toolResult({ success: false, error: "email is required" });
      const intel = await getContactIntel({ tenantId: userId, email, name });
      return toolResult(intel);
    }

    case "summarize_thread": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      const summary = await summarizeThread({ tenantId: userId, threadId });
      return toolResult(summary);
    }

    // ── 5 new tools (39 total) ────────────────────────────────────────────────

    case "mark_not_important": {
      const threadId = String(args.threadId ?? "").trim();
      if (!threadId) return toolResult({ success: false, error: "threadId is required" });
      await inbox.markNotImportant(userId, threadId);
      return toolResult({ success: true, threadId, action: "marked_not_important" });
    }

    case "get_calendar_event": {
      const eventId = String(args.eventId ?? "").trim();
      if (!eventId) return toolResult({ success: false, error: "eventId is required" });
      const calendar = getCalendarService();
      const event = await calendar.getEvent(userId, eventId);
      if (!event) return toolResult({ success: false, error: "Event not found or calendar not connected" });
      return toolResult(event);
    }

    case "find_meeting_slots": {
      const { findMeetingSlots } = await import("@repo/services/ai/meeting-slots");
      const result = await findMeetingSlots({
        tenantId: userId,
        durationMinutes: Math.max(15, Math.min(480, Number(args.durationMinutes ?? 30))),
        preferredStartDate: args.preferredStartDate ? String(args.preferredStartDate) : undefined,
        preferredEndDate: args.preferredEndDate ? String(args.preferredEndDate) : undefined,
        timeZone: args.timeZone ? String(args.timeZone) : undefined,
        attendeeEmail: args.attendeeEmail ? String(args.attendeeEmail) : undefined,
        context: args.context ? String(args.context) : undefined,
      });
      return toolResult(result);
    }

    case "create_draft_email": {
      const to = String(args.to ?? "").trim();
      const subject = String(args.subject ?? "").trim();
      const body = String(args.body ?? "").trim();
      if (!to || !subject || !body) return toolResult({ success: false, error: "to, subject, and body are required" });
      const draft = await inbox.createDraft(userId, {
        to,
        subject,
        body,
        threadId: args.threadId ? String(args.threadId) : undefined,
        cc: args.cc ? String(args.cc) : undefined,
        bcc: args.bcc ? String(args.bcc) : undefined,
      });
      return toolResult({ success: true, draftId: draft.id, subject, to });
    }

    case "update_event_details": {
      const eventId = String(args.eventId ?? "").trim();
      if (!eventId) return toolResult({ success: false, error: "eventId is required" });
      const newSummary = args.summary ? String(args.summary).trim() : undefined;
      const description = args.description ? String(args.description) : undefined;
      const location = args.location ? String(args.location) : undefined;
      if (!newSummary && !description && !location) {
        return toolResult({ success: false, error: "At least one of summary, description, or location is required" });
      }
      const existing = await calendar.getEvent(userId, eventId);
      if (!existing) return toolResult({ success: false, error: "Event not found" });
      const item = await queue.enqueueCalendarUpdate(
        userId,
        {
          update: {
            eventId,
            summary: existing.summary ?? "Event",
            newSummary,
            description,
            location,
            htmlLink: existing.htmlLink,
          },
          title: `Update: ${existing.summary ?? "Event"}`,
        },
        { origin: "agent" },
      );
      return toolResult({
        success: true,
        queued: true,
        queueItemId: item.id,
        status: item.status,
        message: "Event update queued — approve via approve_queue_item or /queue",
      });
    }

    case "get_calendar_connection_status": {
      const status = await calendar.getConnectionStatus(userId);
      return toolResult(status);
    }

    case "mark_thread_unread": {
      const threadId = String(args.threadId ?? "");
      await inbox.markThreadUnread(userId, threadId);
      return toolResult({ ok: true, threadId });
    }

    case "quick_add_event": {
      const text = String(args.text ?? "");
      if (!text.trim()) return toolResult({ error: "text is required" });
      const item = await queue.enqueueQuickAddCalendar(userId, { text }, { origin: "agent" });
      return toolResult({ ok: true, queued: item.status !== "approved", item });
    }

    case "send_draft": {
      const draftId = String(args.draftId ?? "");
      if (!draftId) return toolResult({ error: "draftId is required" });
      const item = await queue.enqueueDraftSend(userId, { draftId }, { origin: "agent" });
      return toolResult({ ok: true, queued: item.status !== "approved", item });
    }

    case "mute_thread": {
      const threadId = String(args.threadId ?? "");
      if (!threadId) return toolResult({ error: "threadId is required" });
      await inbox.muteThread(userId, threadId);
      return toolResult({ ok: true, threadId, muted: true });
    }

    case "unmute_thread": {
      const threadId = String(args.threadId ?? "");
      if (!threadId) return toolResult({ error: "threadId is required" });
      await inbox.unmuteThread(userId, threadId);
      return toolResult({ ok: true, threadId, muted: false });
    }

    case "update_draft": {
      const draftId = String(args.draftId ?? "");
      const to = String(args.to ?? "");
      const subject = String(args.subject ?? "");
      const body = String(args.body ?? "");
      if (!draftId || !to || !subject) return toolResult({ error: "draftId, to, and subject are required" });
      const result = await inbox.updateDraft(userId, draftId, {
        to, subject, body,
        threadId: typeof args.threadId === "string" ? args.threadId : undefined,
        cc: typeof args.cc === "string" ? args.cc : undefined,
        bcc: typeof args.bcc === "string" ? args.bcc : undefined,
      });
      return toolResult({ ok: true, ...result });
    }

    case "batch_modify_threads": {
      const threadIds = Array.isArray(args.threadIds) ? args.threadIds.map(String) : [];
      if (threadIds.length === 0) return toolResult({ error: "threadIds is required" });
      const result = await inbox.batchModifyThreads(userId, {
        threadIds,
        addLabelIds: Array.isArray(args.addLabelIds) ? args.addLabelIds.map(String) : undefined,
        removeLabelIds: Array.isArray(args.removeLabelIds) ? args.removeLabelIds.map(String) : undefined,
      });
      return toolResult({ ok: true, ...result });
    }

    case "list_messages": {
      const result = await inbox.listMessages(userId, {
        maxResults: args.maxResults != null ? Number(args.maxResults) : undefined,
        q: typeof args.q === "string" ? args.q : undefined,
        labelIds: Array.isArray(args.labelIds) ? args.labelIds.map(String) : undefined,
      });
      return toolResult(result);
    }

    case "modify_message": {
      const messageId = String(args.messageId ?? "");
      if (!messageId) return toolResult({ error: "messageId is required" });
      await inbox.modifyMessage(userId, messageId, {
        addLabelIds: Array.isArray(args.addLabelIds) ? args.addLabelIds.map(String) : undefined,
        removeLabelIds: Array.isArray(args.removeLabelIds) ? args.removeLabelIds.map(String) : undefined,
      });
      return toolResult({ ok: true, messageId });
    }

    case "delete_thread": {
      const threadId = String(args.threadId ?? "");
      if (!threadId) return toolResult({ error: "threadId is required" });
      await inbox.deleteThread(userId, threadId);
      return toolResult({ ok: true, threadId, deleted: true });
    }

    case "untrash_thread": {
      const threadId = String(args.threadId ?? "");
      if (!threadId) return toolResult({ error: "threadId is required" });
      await inbox.untrashThread(userId, threadId);
      return toolResult({ ok: true, threadId, untrashed: true });
    }

    case "search_threads_db": {
      const result = await inbox.searchThreadsDb(userId, {
        query: typeof args.query === "string" ? args.query : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
        offset: args.offset != null ? Number(args.offset) : undefined,
      });
      return toolResult(result);
    }

    case "search_messages_db": {
      const result = await inbox.searchMessagesDb(userId, {
        query: typeof args.query === "string" ? args.query : undefined,
        from: typeof args.from === "string" ? args.from : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
        offset: args.offset != null ? Number(args.offset) : undefined,
      });
      return toolResult(result);
    }

    case "search_events_db": {
      const result = await calendar.searchEventsDb(userId, {
        query: typeof args.query === "string" ? args.query : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
        offset: args.offset != null ? Number(args.offset) : undefined,
      });
      return toolResult(result);
    }

    case "search_calendars_db": {
      const result = await calendar.searchCalendarsDb(userId, {
        query: typeof args.query === "string" ? args.query : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
        offset: args.offset != null ? Number(args.offset) : undefined,
      });
      return toolResult(result);
    }

    case "search_drafts_db": {
      const result = await inbox.searchDraftsDb(userId, {
        limit: args.limit != null ? Number(args.limit) : undefined,
        offset: args.offset != null ? Number(args.offset) : undefined,
      });
      return toolResult(result);
    }

    case "search_labels_db": {
      const result = await inbox.searchLabelsDb(userId, {
        name: typeof args.name === "string" ? args.name : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
        offset: args.offset != null ? Number(args.offset) : undefined,
      });
      return toolResult(result);
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
    corsairOfficialMcp: {
      endpoint: "/mcp/corsair",
      tools: ["corsair_setup", "list_operations", "get_schema", "run_script"],
      package: "@corsair-dev/mcp",
    },
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
  const publicMethods = new Set(["initialize", "tools/list", "resources/list", "prompts/list", "notifications/initialized"]);
  if (publicMethods.has(method)) {
    const ipLimitOk = await applyMcpIpRateLimit(req, res);
    if (!ipLimitOk) return;
  }

  try {
    if (method === "initialize") {
      return res.json(
        ok(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "thread-mcp", version: MCP_SERVER_VERSION },
        }),
      );
    }

    if (method === "tools/list") {
      return res.json(ok(id, { tools: MCP_TOOLS }));
    }

    // MCP resources — expose static references to key Thread features
    if (method === "resources/list") {
      return res.json(ok(id, {
        resources: [
          {
            uri: "thread://inbox",
            name: "Gmail Inbox",
            description: "Current Gmail inbox threads fetched via Corsair SDK. Use list_inbox or search_inbox tools to read.",
            mimeType: "application/json",
          },
          {
            uri: "thread://queue",
            name: "Approval Queue",
            description: "Pending AI-composed emails and calendar invites awaiting user approval. Use list_queue tool to read.",
            mimeType: "application/json",
          },
          {
            uri: "thread://brief",
            name: "Daily Brief",
            description: "AI-generated daily productivity brief (Corsair Gmail + Calendar + OpenAI). Use get_daily_brief tool to read.",
            mimeType: "application/json",
          },
          {
            uri: "thread://calendar",
            name: "Google Calendar",
            description: "Upcoming calendar events fetched via Corsair Calendar SDK. Use list_calendar_events or check_free_busy tools.",
            mimeType: "application/json",
          },
        ],
      }));
    }

    // MCP prompts — reusable prompt templates for common Thread workflows
    if (method === "prompts/list") {
      return res.json(ok(id, {
        prompts: [
          {
            name: "daily_brief",
            description: "Generate a personalised daily brief from Gmail + Calendar via Corsair",
            arguments: [{ name: "timeZone", description: "IANA timezone (e.g. Asia/Kolkata)", required: false }],
          },
          {
            name: "meeting_prep",
            description: "Prepare talking points, agenda, and risks for an upcoming calendar event",
            arguments: [
              { name: "eventId", description: "Google Calendar event id", required: true },
              { name: "timeZone", description: "IANA timezone", required: false },
            ],
          },
          {
            name: "smart_reply",
            description: "Generate 3 AI smart-reply suggestions for a Gmail thread via Corsair",
            arguments: [{ name: "threadId", description: "Gmail thread id", required: true }],
          },
          {
            name: "contact_intel",
            description: "Get relationship intelligence for a contact: history, response rate, recommended next action",
            arguments: [
              { name: "email", description: "Contact email address", required: true },
              { name: "name", description: "Contact display name", required: false },
            ],
          },
          {
            name: "missed_followups",
            description: "Find calendar meetings from the past 2 weeks that had no follow-up email sent",
            arguments: [{ name: "timeZone", description: "IANA timezone", required: false }],
          },
        ],
      }));
    }

    if (method === "prompts/get") {
      const params = (body.params ?? {}) as Record<string, unknown>;
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, string>;
      const promptMap: Record<string, string> = {
        daily_brief: `Call get_daily_brief with timeZone="${args.timeZone ?? "UTC"}" to generate a personalised daily brief from Gmail and Google Calendar via Corsair SDK.`,
        meeting_prep: `Call get_meeting_prep with eventId="${args.eventId ?? ""}" and timeZone="${args.timeZone ?? "UTC"}" to prepare talking points, agenda risks, and related emails for this calendar event.`,
        smart_reply: `Call get_smart_replies with threadId="${args.threadId ?? ""}" to generate 3 context-aware reply suggestions for this Gmail thread.`,
        contact_intel: `Call get_contact_intel with email="${args.email ?? ""}"${args.name ? ` and name="${args.name}"` : ""} to retrieve relationship intelligence: interaction history, response rate, recent topics, and recommended next action.`,
        missed_followups: `Call get_missed_followups with timeZone="${args.timeZone ?? "UTC"}" to find calendar meetings from the past 2 weeks that had no follow-up email sent.`,
      };
      const text = promptMap[name];
      if (!text) return res.status(404).json(rpcError(id, -32601, `Prompt not found: ${name}`));
      return res.json(ok(id, { description: name, messages: [{ role: "user", content: { type: "text", text } }] }));
    }

    // MCP resources/read — return live data for static resource URIs
    if (method === "resources/read") {
      const params = (body.params ?? {}) as Record<string, unknown>;
      const uri = String(params.uri ?? "");
      const userId = await resolveMcpUserId(req);
      if (!userId) {
        return res.status(401).json(rpcError(id, -32001, "Authentication required to read resources"));
      }
      const userLimitOk = await applyMcpUserRateLimit(req, res, userId);
      if (!userLimitOk) return;

      try {
        let content: unknown;
        if (uri === "thread://inbox") {
          const inbox = getInboxService();
          const result = await inbox.listThreads(userId, { maxResults: 20 });
          content = result;
        } else if (uri === "thread://queue") {
          const queue = getQueueService();
          const items = await queue.listItems(userId, { status: "pending" });
          content = { items, count: items.length };
        } else if (uri === "thread://brief") {
          const { generateDailyBrief } = await import("@repo/services/ai/daily-brief");
          content = await generateDailyBrief({ tenantId: userId, timeZone: "UTC" });
        } else if (uri === "thread://calendar") {
          const calendar = getCalendarService();
          const now = new Date();
          const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
          content = await calendar.listEvents(userId, { timeMin: now.toISOString(), timeMax, maxResults: 20 });
        } else {
          return res.status(404).json(rpcError(id, -32601, `Unknown resource URI: ${uri}`));
        }
        return res.json(ok(id, {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify(content, null, 2) }],
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json(rpcError(id, -32603, `Failed to read resource: ${msg}`));
      }
    }

    // notifications/initialized — acknowledgment per MCP spec
    if (method === "notifications/initialized") {
      return res.json(ok(id, {}));
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
