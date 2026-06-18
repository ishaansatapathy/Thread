/**
 * Official Corsair MCP adapter (@corsair-dev/mcp) — exposes corsair_setup,
 * list_operations, get_schema, and run_script per Corsair docs.
 */
import { createBaseMcpServer, createMcpRouter } from "@corsair-dev/mcp";
import { Router } from "express";

import { getCorsair, isCorsairConfigured } from "../corsair";
import { env } from "../env";

export const corsairMcpGate = Router();

corsairMcpGate.use((_req, res, next) => {
  if (!isCorsairConfigured()) {
    return res.status(503).json({
      error: "Corsair is not configured (set CORSAIR_KEK and DATABASE_URL)",
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
