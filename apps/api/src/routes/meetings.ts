/**
 * Meetings over REST (the web app uses tRPC for JSON; binary audio has to come here).
 *   POST   /meetings                 create an instance (live or upload)
 *   GET    /meetings                 list
 *   GET    /meetings/:id             read (advances an upload's Gnani job)
 *   POST   /meetings/:id/chunk       live: one voice-gated clip (≤30s) → transcribed + appended
 *   POST   /meetings/:id/audio       upload: a whole recording (≤10 MB) → Gnani batch job
 *   POST   /meetings/:id/end         live: finalise notes
 *   DELETE /meetings/:id
 */
import express, { Router } from "express";
import { z } from "zod";
import AuthService from "@repo/services/auth";
import { ServiceError } from "@repo/services/errors";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";
import { logger } from "@repo/logger";

import {
  appendLiveChunk,
  attachMeetingAudio,
  createMeeting,
  deleteMeeting,
  endMeeting,
  getMeeting,
  listMeetings,
  MAX_CHUNK_AUDIO_BYTES,
  MAX_MEETING_AUDIO_BYTES,
  refreshMeetingNotes,
} from "../services/meetings";

/** "https://meet.google.com/abc-defg-hij?authuser=0" → "abc-defg-hij" */
function meetCodeOf(url: string): string | null {
  return url.match(/meet\.google\.com\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})/i)?.[1]?.toLowerCase() ?? null;
}

const authService = new AuthService();

export const meetingsRouter = Router();

const createMeetingSchema = z.object({
  title: z.string().trim().max(200).optional(),
  languageCode: z.string().trim().max(40).optional(),
  mode: z.enum(["live", "upload"]).optional(),
  meetUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https:\/\/meet\.google\.com\//, "meetUrl must be a Google Meet link")
    .optional(),
});

const idSchema = z.string().uuid();

function errorStatus(code: ServiceError["code"]): number {
  switch (code) {
    case "BAD_REQUEST":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "PRECONDITION_FAILED":
      return 412;
    default:
      return 500;
  }
}

function sendServiceError(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof ServiceError) {
    return res.status(errorStatus(error.code)).json({ error: error.message });
  }
  logger.warn("meetings.route_error", { message: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: fallback });
}

function readFilename(req: express.Request, fallback: string) {
  try {
    return decodeURIComponent(String(req.header("x-file-name") ?? fallback)).slice(0, 200) || fallback;
  } catch {
    return fallback;
  }
}

meetingsRouter.post("/", express.json({ limit: "8kb" }), async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const parsed = createMeetingSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });

  try {
    const meeting = await createMeeting(user.id, parsed.data);
    return res.status(201).json(meeting);
  } catch (error) {
    return sendServiceError(res, error, "Could not create the meeting.");
  }
});

meetingsRouter.get("/", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  // ?meetUrl=https://meet.google.com/abc-defg-hij → only the room(s) for that call (newest first).
  const meetCode = typeof req.query.meetUrl === "string" ? meetCodeOf(req.query.meetUrl) : null;

  try {
    const meetings = await listMeetings(user.id, meetCode ? 100 : 30);
    return res.json({ meetings: meetCode ? meetings.filter((m) => m.meetUrl && meetCodeOf(m.meetUrl) === meetCode) : meetings });
  } catch (error) {
    return sendServiceError(res, error, "Could not list meetings.");
  }
});

meetingsRouter.post("/:id/refresh-notes", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!idSchema.safeParse(req.params.id).success) return res.status(404).json({ error: "Meeting not found." });

  try {
    return res.json(await refreshMeetingNotes(user.id, req.params.id));
  } catch (error) {
    return sendServiceError(res, error, "Could not update the notes.");
  }
});

meetingsRouter.get("/:id", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!idSchema.safeParse(req.params.id).success) return res.status(404).json({ error: "Meeting not found." });

  try {
    const meeting = await getMeeting(user.id, req.params.id);
    return res.json(meeting);
  } catch (error) {
    return sendServiceError(res, error, "Could not load the meeting.");
  }
});

/**
 * POST /meetings/:id/chunk — one live clip. Body: WAV (16 kHz mono from the browser).
 * Headers: X-Start-Seconds, X-Duration-Seconds, X-Speaker (you|meeting), X-Language.
 */
meetingsRouter.post(
  "/:id/chunk",
  express.raw({ type: () => true, limit: MAX_CHUNK_AUDIO_BYTES + 1024 }),
  async (req, res) => {
    const user = await authService.resolveSession(req, res);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (!idSchema.safeParse(req.params.id).success) return res.status(404).json({ error: "Meeting not found." });

    if (process.env.VITEST !== "true") {
      // Two streams × one clip every few seconds; generous but bounded.
      const limit = await checkDistributedRateLimit(`meeting-chunk:${user.id}`, 240, 60_000);
      if (!limit.allowed) return res.status(429).json({ error: "Too many audio chunks. Slow down." });
    }

    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      return res.status(400).json({ error: "Send the audio clip as the request body" });
    }

    const startSeconds = Number(req.header("x-start-seconds") ?? 0);
    const durationSeconds = Number(req.header("x-duration-seconds") ?? 0);
    const rawSpeaker = req.header("x-speaker");
    const speaker = rawSpeaker === "meeting" || rawSpeaker === "room" ? rawSpeaker : "you";
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return res.status(400).json({ error: "X-Start-Seconds and X-Duration-Seconds are required" });
    }
    if (durationSeconds > 31) return res.status(400).json({ error: "Live chunks must be 30 seconds or shorter." });

    try {
      const segment = await appendLiveChunk(user.id, req.params.id, {
        audio: {
          data: req.body,
          filename: readFilename(req, "chunk.wav"),
          mimeType: String(req.header("x-file-type") ?? "").trim() || "audio/wav",
        },
        startSeconds,
        durationSeconds,
        speaker,
        languageCode: req.header("x-language") ?? undefined,
      });
      return res.json({ segment });
    } catch (error) {
      return sendServiceError(res, error, "Could not transcribe that audio.");
    }
  },
);

/**
 * POST /meetings/:id/audio — upload mode: submit a whole recording. Body is the raw
 * audio file; name/type travel in headers, same convention as /agent/uploads.
 */
meetingsRouter.post(
  "/:id/audio",
  express.raw({ type: () => true, limit: MAX_MEETING_AUDIO_BYTES + 1024 }),
  async (req, res) => {
    const user = await authService.resolveSession(req, res);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (!idSchema.safeParse(req.params.id).success) return res.status(404).json({ error: "Meeting not found." });

    if (process.env.VITEST !== "true") {
      const limit = await checkDistributedRateLimit(`meeting-audio:${user.id}`, 10, 60_000);
      if (!limit.allowed) return res.status(429).json({ error: "Too many uploads. Try again in a minute." });
    }

    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      return res.status(400).json({ error: "Send the audio file as the request body" });
    }

    const mimeType = String(req.header("x-file-type") ?? "").trim() || "audio/wav";

    try {
      const meeting = await attachMeetingAudio(user.id, req.params.id, {
        data: req.body,
        filename: readFilename(req, "recording.wav"),
        mimeType,
      });
      return res.status(202).json(meeting);
    } catch (error) {
      return sendServiceError(res, error, "Could not submit the recording.");
    }
  },
);

meetingsRouter.post("/:id/end", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!idSchema.safeParse(req.params.id).success) return res.status(404).json({ error: "Meeting not found." });

  try {
    return res.json(await endMeeting(user.id, req.params.id));
  } catch (error) {
    return sendServiceError(res, error, "Could not end the meeting.");
  }
});

meetingsRouter.delete("/:id", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!idSchema.safeParse(req.params.id).success) return res.status(404).json({ error: "Meeting not found." });

  try {
    await deleteMeeting(user.id, req.params.id);
    return res.status(204).end();
  } catch (error) {
    return sendServiceError(res, error, "Could not delete the meeting.");
  }
});

meetingsRouter.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "That audio is too large." });
  }
  return next(err);
});
