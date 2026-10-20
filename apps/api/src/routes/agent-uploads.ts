import express, { Router } from "express";
import AuthService from "@repo/services/auth";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";
import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";

import { CorsairWorkspaceService, MAX_AGENT_UPLOAD_BYTES } from "../services/workspace";

const authService = new AuthService();
const workspace = new CorsairWorkspaceService();

export const agentUploadsRouter = Router();

/**
 * POST /agent/uploads — stage a file dropped into Agent chat so a queued Drive save
 * can upload it after approval. Body is the raw file (application/octet-stream);
 * the name and type travel in X-File-Name / X-File-Type headers.
 */
agentUploadsRouter.post(
  "/",
  express.raw({ type: "application/octet-stream", limit: MAX_AGENT_UPLOAD_BYTES + 1024 }),
  async (req, res) => {
    const user = await authService.resolveSession(req, res);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    if (process.env.VITEST !== "true") {
      const limit = await checkDistributedRateLimit(`agent-upload:${user.id}`, 30, 60_000);
      if (!limit.allowed) return res.status(429).json({ error: "Too many uploads. Try again in a minute." });
    }

    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      return res.status(400).json({ error: "Send the file body as application/octet-stream" });
    }

    let filename = "attachment";
    try {
      filename = decodeURIComponent(String(req.header("x-file-name") ?? "attachment"));
    } catch {
      filename = "attachment";
    }
    const mimeType = String(req.header("x-file-type") ?? "").trim() || "application/octet-stream";

    try {
      const staged = await workspace.stageUpload(user.id, { filename, mimeType, data: req.body });
      return res.status(201).json(staged);
    } catch (error) {
      if (error instanceof ServiceError && error.code === "BAD_REQUEST") {
        return res.status(400).json({ error: error.message });
      }
      logger.warn("agent.upload.failed", {
        userId: user.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Could not store the file" });
    }
  },
);

agentUploadsRouter.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Files up to 4 MB can be attached in chat" });
  }
  return next(err);
});
