import { Router } from "express";
import { executePermission } from "corsair";
import { logger } from "@repo/logger";

import { getCorsair, getCorsairPool, isCorsairConfigured } from "../corsair";
import { resolveMcpUserId } from "../mcp-auth";

export const corsairPermissionsRouter = Router();

export { formatCorsairApprovalMessage } from "../services/corsair-approval";

corsairPermissionsRouter.get("/:token", async (req, res) => {
  if (!isCorsairConfigured()) {
    return res.status(503).json({ error: "Corsair is not configured" });
  }

  const token = req.params.token?.trim();
  if (!token) return res.status(400).json({ error: "token is required" });

  try {
    const corsair = getCorsair();
    const record = await corsair.permissions.find_by_token(token);
    if (!record) return res.status(404).json({ error: "Permission request not found" });

    let args: unknown = record.args;
    if (typeof record.args === "string") {
      try {
        args = JSON.parse(record.args);
      } catch {
        args = record.args;
      }
    }

    return res.json({
      token: record.token,
      plugin: record.plugin,
      endpoint: record.endpoint,
      status: record.status,
      tenantId: record.tenant_id,
      expiresAt: record.expires_at,
      args,
    });
  } catch (error) {
    logger.warn("corsair.permissions.get failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Failed to load permission request" });
  }
});

async function setPermissionStatus(token: string, status: "approved" | "denied") {
  const pool = getCorsairPool();
  await pool.query(
    `UPDATE corsair_permissions SET status = $1, updated_at = NOW() WHERE token = $2 AND status = 'pending'`,
    [status, token],
  );
}

corsairPermissionsRouter.post("/:token/approve", async (req, res) => {
  if (!isCorsairConfigured()) {
    return res.status(503).json({ error: "Corsair is not configured" });
  }

  const token = req.params.token?.trim();
  if (!token) return res.status(400).json({ error: "token is required" });

  const userId = await resolveMcpUserId(req);
  if (!userId) return res.status(401).json({ error: "Authentication required" });

  try {
    const corsair = getCorsair();
    const record = await corsair.permissions.find_by_token(token);
    if (!record) return res.status(404).json({ error: "Permission request not found" });
    if (record.tenant_id && record.tenant_id !== userId && record.tenant_id !== "default") {
      return res.status(403).json({ error: "Not authorized for this permission request" });
    }
    if (record.status !== "pending") {
      return res.status(409).json({ error: `Request already ${record.status}` });
    }

    await setPermissionStatus(token, "approved");
    const result = await executePermission(corsair, token);
    return res.json({ ok: true, token, result });
  } catch (error) {
    logger.warn("corsair.permissions.approve failed", {
      token,
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to execute approved action",
    });
  }
});

corsairPermissionsRouter.post("/:token/deny", async (req, res) => {
  if (!isCorsairConfigured()) {
    return res.status(503).json({ error: "Corsair is not configured" });
  }

  const token = req.params.token?.trim();
  if (!token) return res.status(400).json({ error: "token is required" });

  const userId = await resolveMcpUserId(req);
  if (!userId) return res.status(401).json({ error: "Authentication required" });

  try {
    const corsair = getCorsair();
    const record = await corsair.permissions.find_by_token(token);
    if (!record) return res.status(404).json({ error: "Permission request not found" });
    if (record.tenant_id && record.tenant_id !== userId && record.tenant_id !== "default") {
      return res.status(403).json({ error: "Not authorized for this permission request" });
    }

    await setPermissionStatus(token, "denied");
    return res.json({ ok: true, token, status: "denied" });
  } catch (error) {
    logger.warn("corsair.permissions.deny failed", {
      token,
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Failed to deny permission request" });
  }
});
