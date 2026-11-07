/**
 * Gnani speech for the app:
 *   POST /speech/transcribe       push-to-talk voice input for the agent. Body: one WAV clip ≤30s.
 *   POST /speech/speak            read text aloud with a Gnani voice. JSON { text, language, voice? } → MP3.
 *   POST /speech/translate-speak  translate selected text and read the translation aloud.
 *                                 JSON { text, target } → { translation, audio (base64 MP3), cached }.
 */
import express, { Router } from "express";
import AuthService from "@repo/services/auth";
import { ServiceError } from "@repo/services/errors";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";
import { logger } from "@repo/logger";

import { translateSelection, DUB_TARGETS, isDubTarget } from "../services/dub-translate";
import {
  GNANI_LANGUAGES,
  canGnaniSpeak,
  gnaniVoiceForPitch,
  isGnaniConfigured,
  normalizeGnaniLanguage,
  speakText,
  transcribeClip,
} from "../services/gnani";
import { MAX_CHUNK_AUDIO_BYTES } from "../services/meetings";
import { translateCached } from "../services/translation-cache";

const authService = new AuthService();

export const speechRouter = Router();

const MAX_SPEAK_CHARS = 5000;
const MAX_TRANSLATE_CHARS = 1500;

speechRouter.get("/status", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  return res.json({
    configured: isGnaniConfigured(),
    provider: "gnani",
    languages: GNANI_LANGUAGES,
    tts: isGnaniConfigured(),
    translateTargets: DUB_TARGETS.filter((t) => canGnaniSpeak(t.code)),
  });
});

function sendSpeechError(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof ServiceError) {
    const status = error.code === "PRECONDITION_FAILED" ? 412 : error.code === "BAD_REQUEST" ? 400 : 502;
    return res.status(status).json({ error: error.message });
  }
  logger.warn("speech.route_failed", { message: error instanceof Error ? error.message : String(error) });
  return res.status(502).json({ error: fallback });
}

speechRouter.post("/speak", express.json({ limit: "32kb" }), async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!isGnaniConfigured()) return res.status(412).json({ error: "Read-aloud needs GNANI_API_KEY on the server." });

  if (process.env.VITEST !== "true") {
    const limit = await checkDistributedRateLimit(`speech-speak:${user.id}`, 30, 60_000);
    if (!limit.allowed) return res.status(429).json({ error: "Too many read-aloud requests. Try again in a minute." });
  }

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "Send the text to read" });
  if (text.length > MAX_SPEAK_CHARS) return res.status(400).json({ error: `Text can be up to ${MAX_SPEAK_CHARS} characters.` });
  const language = typeof req.body?.language === "string" ? req.body.language : "en-IN";
  const voice = req.body?.voice === "female" ? gnaniVoiceForPitch(220) : gnaniVoiceForPitch(110);

  try {
    const speech = await speakText({ text, language, voice });
    return res.type(speech.mimeType).send(speech.audio);
  } catch (error) {
    return sendSpeechError(res, error, "Could not read that aloud.");
  }
});

speechRouter.post("/translate-speak", express.json({ limit: "16kb" }), async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!isGnaniConfigured()) return res.status(412).json({ error: "Translate & listen needs GNANI_API_KEY on the server." });

  if (process.env.VITEST !== "true") {
    const limit = await checkDistributedRateLimit(`speech-translate:${user.id}`, 30, 60_000);
    if (!limit.allowed) return res.status(429).json({ error: "Too many translations. Try again in a minute." });
  }

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const target = String(req.body?.target ?? "");
  if (!text) return res.status(400).json({ error: "Select some text to translate" });
  if (text.length > MAX_TRANSLATE_CHARS) {
    return res.status(400).json({ error: `Select up to ${MAX_TRANSLATE_CHARS} characters at a time.` });
  }
  if (!isDubTarget(target) || !canGnaniSpeak(target)) return res.status(400).json({ error: "Pick one of the Indian languages or English." });

  try {
    const { translation, cached } = await translateCached(`sel:${user.id}`, target, text, () => translateSelection(text, target));
    if (!translation) return res.status(502).json({ error: "Could not translate that." });
    const speech = await speakText({
      text: translation,
      language: target,
      voice: req.body?.voice === "female" ? gnaniVoiceForPitch(220) : gnaniVoiceForPitch(110),
    });
    return res.json({ translation, cached, mimeType: speech.mimeType, audio: speech.audio.toString("base64") });
  } catch (error) {
    return sendSpeechError(res, error, "Could not translate that.");
  }
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

speechRouter.use((err: Error & { type?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: req.path === "/transcribe" ? "Voice clips can be up to 30 seconds." : "That text is too long." });
  }
  return next(err);
});
