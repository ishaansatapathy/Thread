/**
 * Official Corsair MCP adapter (@corsair-dev/mcp) — exposes corsair_setup,
 * list_operations, get_schema, and run_script per Corsair docs.
 */
import { createBaseMcpServer, createMcpRouter } from "@corsair-dev/mcp";
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";

import { getCorsair, isCorsairConfigured } from "../corsair";
import { env } from "../env";
import { resolveMcpUserId } from "../mcp-auth";

export const corsairMcpGate = Router();

corsairMcpGate.use((_req, res, next) => {
  if (!isCorsairConfigured()) {
    return res.status(503).json({
      error: "Corsair is not configured (set CORSAIR_KEK and DATABASE_URL)",
    });
  }
  next();
});

/** Same auth model as /mcp — session cookies or bound THREAD_MCP_API_KEY + THREAD_MCP_USER_ID. */
corsairMcpGate.use(async (req: Request, res: Response, next: NextFunction) => {
  const userId = await resolveMcpUserId(req);
  if (!userId) {
    return res.status(401).json({
      error: "Authentication required. Sign in via Thread or use Authorization: Bearer <THREAD_MCP_API_KEY>.",
    });
  }
  next();
});

export const corsairOfficialMcpRouter = createMcpRouter(() =>
  createBaseMcpServer({
    corsair: getCorsair() as { [key: string]: unknown },
    setup: true,
    basePermissionUrl: `${env.CLIENT_URL}/corsair/approve`,
  }),
);
