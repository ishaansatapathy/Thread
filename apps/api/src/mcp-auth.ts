import type { Request } from "express";
import { eq } from "@repo/database";
import db from "@repo/database";
import { usersTable } from "@repo/database/schema";
import { logger } from "@repo/logger";

import { authService } from "@repo/trpc/server/services";

/**
 * Resolves the Thread user id for MCP tool calls.
 *
 * Session cookies (web sign-in) always win.
 * Headless access requires THREAD_MCP_API_KEY bound to THREAD_MCP_USER_ID —
 * arbitrary X-Thread-User-Id impersonation is not allowed.
 */
export async function resolveMcpUserId(req: Request): Promise<string | null> {
  const sessionUser = await authService.resolveSession(req);
  if (sessionUser) {
    req.headers["x-mcp-user-id"] = sessionUser.id;
    return sessionUser.id;
  }

  const apiKey = process.env.THREAD_MCP_API_KEY?.trim();
  const boundUserId = process.env.THREAD_MCP_USER_ID?.trim();
  const authHeader = req.header("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!apiKey || !boundUserId || !bearer || bearer !== apiKey) {
    return null;
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, boundUserId))
    .limit(1);

  if (!user) {
    logger.warn("MCP API key auth rejected — bound user not found", { boundUserId });
    return null;
  }

  logger.info("MCP API key auth", { userId: boundUserId, method: req.method, path: req.path });
  req.headers["x-mcp-user-id"] = boundUserId;
  return boundUserId;
}
