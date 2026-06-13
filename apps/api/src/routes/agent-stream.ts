/**
 * Agent SSE streaming endpoint — POST /agent/stream
 *
 * Instead of waiting up to 120s for the complete agent response, this endpoint
 * streams Server-Sent Events in real-time as the agent works:
 *
 *   event: status
 *   data: {"tool":"search_inbox","label":"Searching inbox…"}
 *
 *   event: status
 *   data: {"tool":"queue_email","label":"Queuing email…"}
 *
 *   event: complete
 *   data: {"reply":"Done! …","actions":[…]}
 *
 *   event: error
 *   data: {"message":"OpenAI timed out"}
 *
 * The client uses the native EventSource API (or fetch with ReadableStream).
 * Auth: same JWT cookies as tRPC.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "@repo/logger";
import { authService } from "@repo/trpc/server/services";
import { runAgentChatStream } from "@repo/services/ai/agent-stream";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";

export const agentStreamRouter = Router();

const skipInTests = () => process.env.VITEST === "true";

agentStreamRouter.post("/", async (req: Request, res: Response) => {
  const user = await authService.resolveSession(req, res);
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Per-user rate limit (same as tRPC agent — 20 calls/min).
  if (!skipInTests()) {
    const result = await checkDistributedRateLimit(`agent:${user.id}`, 20, 60_000);
    res.setHeader("RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      return res.status(429).json({ error: "Too many agent requests. Please wait." });
    }
  }

  const { message, history, userEmail } = req.body as {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    userEmail?: string;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering
  res.flushHeaders();

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Flush immediately so the browser receives it without buffering.
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  }

  try {
    const result = await runAgentChatStream(
      user.id,
      { message: message.trim(), history, userEmail },
      (toolName) => {
        send("status", { tool: toolName, label: toolStatusLabel(toolName) });
      },
    );

    send("complete", { reply: result.reply, actions: result.actions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent encountered an error";
    logger.warn("agent.stream.error", { userId: user.id, error: message });
    send("error", { message });
  } finally {
    res.end();
  }
});

function toolStatusLabel(tool: string): string {
  const labels: Record<string, string> = {
    search_inbox: "Searching inbox…",
    get_thread: "Reading thread…",
    rank_inbox: "Ranking threads by urgency…",
    queue_email: "Preparing email…",
    queue_calendar_invite: "Preparing calendar invite…",
    list_queue: "Checking queue…",
    list_calendar_events: "Checking calendar…",
  };
  return labels[tool] ?? `Running ${tool}…`;
}
