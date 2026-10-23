/**
 * Agent SSE streaming endpoint — POST /agent/stream
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "@repo/logger";
import { authService, invalidateBriefCache } from "@repo/trpc/server/services";
import { runAgentChatStream } from "@repo/services/ai/agent-stream";
import {
  appendAgentSessionTurn,
  getAgentSession,
} from "@repo/services/ai/agent-sessions";
import { PAGE_CONTEXT_MAX_CHARS } from "@repo/services/ai/agent-page-context";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";

const toolMemoryEntrySchema = z.object({
  at: z.string(),
  tool: z.string(),
  summary: z.string(),
  threadId: z.string().optional(),
  eventId: z.string().optional(),
  query: z.string().optional(),
  refs: z
    .array(z.object({ name: z.string().max(200), url: z.string().max(500).optional(), id: z.string().max(200).optional() }))
    .max(8)
    .optional(),
});

const agentStreamBodySchema = z.object({
  message: z.string().trim().min(1, "message is required").max(4000),
  sessionId: z.string().uuid().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(24)
    .optional(),
  toolMemory: z.array(toolMemoryEntrySchema).max(12).optional(),
  userEmail: z.string().email().optional(),
  focusThreadId: z.string().trim().min(1).max(128).optional(),
  focusEventId: z.string().trim().min(1).max(256).optional(),
  focusThreadLabel: z.string().trim().min(1).max(200).optional(),
  focusEventLabel: z.string().trim().min(1).max(200).optional(),
  /** When true, client intentionally cleared focus — do not reload from session. */
  focusCleared: z.boolean().optional(),
  /** The Thread meeting room the user is chatting from; adds live meeting context. */
  focusMeetingId: z.string().uuid().optional(),
  /** Text the user picked on a web page through Captain Thread (browser extension). */
  pageContext: z
    .object({
      url: z.string().url().max(2000),
      title: z.string().trim().max(300).optional(),
      text: z.string().trim().min(1).max(PAGE_CONTEXT_MAX_CHARS),
      source: z.enum(["selection", "area", "page"]),
    })
    .optional(),
});

export const agentStreamRouter = Router();

const skipInTests = () => process.env.VITEST === "true";

agentStreamRouter.post("/", async (req: Request, res: Response) => {
  const user = await authService.resolveSession(req, res);
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!skipInTests()) {
    const result = await checkDistributedRateLimit(`agent:${user.id}`, 20, 60_000);
    res.setHeader("RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      return res.status(429).json({ error: "Too many agent requests. Please wait." });
    }
  }

  const parsed = agentStreamBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
  }

  const {
    message,
    sessionId,
    history,
    toolMemory,
    userEmail,
    focusThreadId,
    focusEventId,
    focusThreadLabel,
    focusEventLabel,
    focusCleared,
    focusMeetingId,
    pageContext,
  } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const abortController = new AbortController();
  const onClientClose = () => {
    if (!res.writableEnded) abortController.abort();
  };
  req.on("close", onClientClose);

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  }

  try {
    let effectiveHistory = history;
    let effectiveToolMemory = toolMemory ?? [];
    let effectiveFocus = {
      threadId: focusThreadId,
      eventId: focusEventId,
    };
    let effectiveThreadLabel = focusThreadLabel;
    let effectiveEventLabel = focusEventLabel;

    if (sessionId) {
      const session = await getAgentSession(user.id, sessionId);
      if (!session) {
        send("error", { message: "Session not found" });
        return;
      }
      effectiveHistory = session.messages;
      effectiveToolMemory = session.toolMemory;
      if (focusCleared) {
        effectiveFocus = { threadId: undefined, eventId: undefined };
        effectiveThreadLabel = undefined;
        effectiveEventLabel = undefined;
      } else if (focusThreadId || focusEventId) {
        effectiveFocus = { threadId: focusThreadId, eventId: focusEventId };
      } else {
        effectiveFocus = {
          threadId: session.focus.threadId,
          eventId: session.focus.eventId,
        };
        effectiveThreadLabel = session.focus.threadLabel;
        effectiveEventLabel = session.focus.eventLabel;
      }
    }

    const result = await runAgentChatStream(
      user.id,
      {
        message: message.trim(),
        history: effectiveHistory,
        toolMemory: effectiveToolMemory,
        userEmail,
        focus: effectiveFocus,
        meetingId: focusMeetingId,
        pageContext,
      },
      (toolName) => {
        send("status", { tool: toolName, label: toolStatusLabel(toolName) });
      },
      (delta) => {
        send("token", { text: delta });
      },
      { signal: abortController.signal },
    );

    let persistedSessionId = sessionId;

    if (sessionId) {
      const updated = await appendAgentSessionTurn(user.id, sessionId, {
        userMessage: message.trim(),
        assistantReply: result.reply,
        toolMemory: result.toolMemory ?? effectiveToolMemory,
        focusCleared: result.focusCleared,
        focus: result.focusCleared
          ? null
          : {
              threadId: effectiveFocus.threadId,
              eventId: effectiveFocus.eventId,
              threadLabel: effectiveThreadLabel,
              eventLabel: effectiveEventLabel,
            },
      });
      if (!updated) {
        logger.warn("agent.stream.session_persist_failed", { userId: user.id, sessionId });
      }
    }

    if (result.actions.some((a) => a.kind === "email_queued" || a.kind === "calendar_queued")) {
      invalidateBriefCache(user.id);
    }

    send("complete", {
      reply: result.reply,
      actions: result.actions,
      sessionId: persistedSessionId,
      focusCleared: result.focusCleared ?? false,
      effectiveFocus: result.effectiveFocus ?? effectiveFocus,
      toolMemory: result.toolMemory ?? effectiveToolMemory,
    });
  } catch (error) {
    if (abortController.signal.aborted) return;
    const errMessage = error instanceof Error ? error.message : "Agent encountered an error";
    logger.warn("agent.stream.error", { userId: user.id, error: errMessage });
    send("error", { message: errMessage });
  } finally {
    req.off("close", onClientClose);
    res.end();
  }
});

function toolStatusLabel(tool: string): string {
  const labels: Record<string, string> = {
    search_inbox: "Searching inbox…",
    get_thread: "Reading thread…",
    summarize_thread: "Summarizing email…",
    rank_inbox: "Ranking threads by urgency…",
    queue_email: "Preparing email…",
    queue_calendar_invite: "Preparing calendar invite…",
    list_queue: "Checking queue…",
    list_calendar_events: "Checking calendar…",
    search_drive: "Searching Drive…",
    read_drive_file: "Reading the file…",
    read_doc: "Reading the doc…",
    read_sheet: "Reading the sheet…",
    read_presentation: "Reading the deck…",
    get_form_responses: "Reading form responses…",
    list_meetings: "Looking up meetings…",
    get_meeting: "Reading the meeting…",
    queue_doc_create: "Drafting the doc…",
    queue_sheet_create: "Building the sheet…",
    queue_slides_create: "Building the deck…",
    queue_form_create: "Building the form…",
    create_meet_link: "Creating a Meet link…",
    list_classroom_due_work: "Checking Classroom…",
  };
  return labels[tool] ?? `Running ${tool}…`;
}
