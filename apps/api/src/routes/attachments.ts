import { Router } from "express";
import AuthService from "@repo/services/auth";
import { logger } from "@repo/logger";
import { getCorsair } from "../corsair";

const authService = new AuthService();

export const attachmentsRouter = Router();

/**
 * GET /inbox/attachments/:messageId/:attachmentId
 * Proxies a Gmail attachment to the client so the browser can download it.
 * The filename and mimeType are passed as query params.
 */
attachmentsRouter.get("/:messageId/:attachmentId", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { messageId, attachmentId } = req.params;
  const filename = typeof req.query.filename === "string" ? req.query.filename : "attachment";
  const mimeType =
    typeof req.query.mimeType === "string" ? req.query.mimeType : "application/octet-stream";

  if (!messageId || !attachmentId) {
    return res.status(400).json({ error: "messageId and attachmentId are required" });
  }

  try {
    const corsair = getCorsair().withTenant(user.id);
    const attachment = await (
      corsair.gmail.api.users as {
        messages: {
          attachments: {
            get: (opts: {
              userId: string;
              messageId: string;
              id: string;
            }) => Promise<{ data?: string; size?: number }>;
          };
        };
      }
    ).messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });

    if (!attachment.data) {
      return res.status(404).json({ error: "Attachment data not found" });
    }

    // Gmail returns base64url-encoded data
    const buffer = Buffer.from(attachment.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");

    const safeFilename = filename.replace(/[^\w.\-() ]/g, "_").slice(0, 200);

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, max-age=300");

    return res.send(buffer);
  } catch (error) {
    logger.warn("attachment.download.failed", {
      userId: user.id,
      messageId,
      attachmentId,
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Failed to fetch attachment" });
  }
});
