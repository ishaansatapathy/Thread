/**
 * POST /speech/transcribe — push-to-talk voice input for the agent (and so every Google
 * app it drives). Body: one WAV clip ≤30s. Header X-Language picks the Gnani language.
 */
import express, { Router } from "express";
import AuthService from "@repo/services/auth";
import { ServiceError } from "@repo/services/errors";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";
import { logger } from "@repo/logger";

import { GNANI_LANGUAGES, isGnaniConfigured, normalizeGnaniLanguage, transcribeClip } from "../services/gnani";
import { MAX_CHUNK_AUDIO_BYTES } from "../services/meetings";

const authService = new AuthService();

export const speechRouter = Router();

speechRouter.get("/status", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  return res.json({ configured: isGnaniConfigured(), provider: "gnani", languages: GNANI_LANGUAGES });
});

speechRouter.post(
  "/transcribe",
  express.raw({ type: () => true, limit: MAX_CHUNK_AUDIO_BYTES + 1024 }),
  async (req, res) => {
    const user = await authService.resolveSession(req, res);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    if (!isGnaniConfigured()) {
      return res.status(412).json({ error: "Voice input needs GNANI_API_KEY on the server." });
    }

    if (process.env.VITEST !== "true") {
      const limit = await checkDistributedRateLimit(`speech:${user.id}`, 60, 60_000);
      if (!limit.allowed) return res.status(429).json({ error: "Too many voice requests. Try again in a minute." });
    }

    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      return res.status(400).json({ error: "Send the audio clip as the request body" });
    }

    const language = normalizeGnaniLanguage(req.header("x-language"));
    try {
      const text = await transcribeClip(
        { data: req.body, filename: "voice.wav", mimeType: String(req.header("x-file-type") ?? "").trim() || "audio/wav" },
        language,
      );
      return res.json({ text, language });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.code === "PRECONDITION_FAILED" ? 412 : 502).json({ error: error.message });
      }
      logger.warn("speech.transcribe_failed", { message: error instanceof Error ? error.message : String(error) });
      return res.status(502).json({ error: "Could not transcribe that audio." });
    }
  },
);

speechRouter.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Voice clips can be up to 30 seconds." });
  }
  return next(err);
});
