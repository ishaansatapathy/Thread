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
import { incrementCounter } from "../metrics";
import { authService } from "@repo/trpc/server/services";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";

const skipInTests = () => process.env.VITEST === "true";

async function applyMcpRateLimit(req: Request, res: Response): Promise<boolean> {
  if (skipInTests()) return true;
  // 60 tool calls per user per minute. Keyed on userId if authenticated, else IP.
  const userId = req.headers["x-mcp-user-id"] as string | undefined;
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const key = userId ? `mcp:user:${userId}` : `mcp:ip:${ip}`;
  const result = await checkDistributedRateLimit(key, 60, 60_000);
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
];

// ────────────────────────────────────────────────────────────────────────────
// Auth helper — resolve userId from Bearer token (session-based)
// ────────────────────────────────────────────────────────────────────────────

async function resolveUserId(req: Request): Promise<string | null> {
  const user = await authService.resolveSession(req);
  return user?.id ?? null;
}

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
    version: "1.0.0",
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

  // Apply rate limit early (before auth so unauthenticated flood is also throttled).
  const rateLimitOk = await applyMcpRateLimit(req, res);
  if (!rateLimitOk) return;

  const id = body.id ?? null;
  const method = body.method;

  try {
    if (method === "initialize") {
      return res.json(
        ok(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "thread-mcp", version: "1.0.0" },
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

      const userId = await resolveUserId(req);
      if (!userId) {
        return res.status(401).json(rpcError(id, -32001, "Authentication required"));
      }

      // Re-key rate limit on userId now that we know it.
      req.headers["x-mcp-user-id"] = userId;

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
