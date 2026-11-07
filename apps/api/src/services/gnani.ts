/**
 * Gnani Batch STT — speech-to-text for meeting-length audio (REST STT caps at 60s,
 * which recordings always exceed). Flow: create a job, start it, poll until it's
 * terminal, then fetch the transcript from the file's transcript_url.
 *
 * API reference: https://docs.gnani.ai/api/STTBatch/Introduction.md
 */
import { logger } from "@repo/logger";
import { serviceError } from "@repo/services/errors";

import type { MeetingSegment } from "@repo/database/schema";

const GNANI_BASE_URL = (process.env.GNANI_BASE_URL?.trim() || "https://api.vachana.ai").replace(/\/$/, "");
const GNANI_MODEL = "gnani-prisma-v2.5";

export function isGnaniConfigured() {
  return Boolean(process.env.GNANI_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.GNANI_API_KEY?.trim();
  if (!key) throw serviceError("PRECONDITION_FAILED", "Gnani is not configured. Set GNANI_API_KEY.");
  return key;
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL_FAILURE", "FAILED", "START_FAILED", "CANCELLED"]);

export type GnaniJobStatus =
  | "CREATED"
  | "STARTING"
  | "QUEUED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PARTIAL_FAILURE"
  | "FAILED"
  | "START_FAILED"
  | "CANCELLED";

export function isTerminalGnaniStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Gnani allows one active request per API key at a time — across speech-to-text AND text-to-speech;
 * a second one gets a 429. So every request to Gnani goes through this single queue. Interactive work
 * (a caption clip, dictation, read-aloud) is served before bulk work (dubbing a whole meeting) so a
 * long dub never freezes live captions. Slots are handed straight to the next waiter, so the limit
 * is never exceeded even for a moment.
 */
export type GnaniPriority = "interactive" | "bulk";
const CONCURRENCY = Math.max(1, Number(process.env.GNANI_CONCURRENCY) || 1);
let activeRequests = 0;
const waiting: Record<GnaniPriority, Array<() => void>> = { interactive: [], bulk: [] };

async function withGnaniSlot<T>(fn: () => Promise<T>, priority: GnaniPriority = "interactive"): Promise<T> {
  if (activeRequests < CONCURRENCY) activeRequests++;
  else await new Promise<void>((resolve) => waiting[priority].push(resolve)); // the releaser hands its slot over
  try {
    return await fn();
  } finally {
    const next = waiting.interactive.shift() ?? waiting.bulk.shift();
    if (next) next();
    else activeRequests--;
  }
}

const backoffMs = (attempt: number) => 600 * (attempt + 1) + Math.random() * 400;

type FetchOptions = {
  priority?: GnaniPriority;
  timeoutMs?: number;
  /** Safe to repeat after a 5xx (reads and clip transcription); creating jobs is not. */
  retryServerErrors?: boolean;
};

async function gnaniFetch<T>(path: string, init: RequestInit = {}, opts: FetchOptions = {}): Promise<T> {
  const { priority = "interactive", timeoutMs = 45_000, retryServerErrors = false } = opts;
  type Outcome = { ok: true; data: T } | { ok: false; status: number; text: string };
  for (let attempt = 0; ; attempt++) {
    // The timeout matters more than usual here: one stuck request would hold the only slot for everyone.
    const outcome = await withGnaniSlot<Outcome>(async () => {
      const res = await fetch(`${GNANI_BASE_URL}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), "X-API-Key-ID": apiKey() },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { ok: true, data: (await res.json()) as T };
      return { ok: false, status: res.status, text: await res.text().catch(() => "") };
    }, priority);
    if (outcome.ok) return outcome.data;

    // A 429 means another process (e.g. a dev machine) holds the key's only slot — wait and retry.
    if ((outcome.status === 429 || (retryServerErrors && outcome.status >= 500)) && attempt < 4) {
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      continue;
    }
    logger.warn("gnani.request_failed", { path, status: outcome.status, body: outcome.text.slice(0, 500) });
    if (outcome.status === 401) throw serviceError("PRECONDITION_FAILED", "Gnani rejected the API key.");
    if (outcome.status === 429) throw serviceError("INTERNAL", "Gnani is busy. Try again in a moment.");
    throw serviceError("INTERNAL", `Gnani request failed (${outcome.status}).`);
  }
}

/** Languages Gnani's Prisma model handles; code-mixed Hinglish works under hi-IN. */
export const GNANI_LANGUAGES = [
  "en-IN",
  "hi-IN",
  "bn-IN",
  "ta-IN",
  "te-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "gu-IN",
  "pa-IN",
] as const;

export function normalizeGnaniLanguage(value: string | undefined | null): string {
  const code = (value ?? "").trim();
  return (GNANI_LANGUAGES as readonly string[]).includes(code) ? code : "en-IN";
}

/** Max clip length for the synchronous REST endpoint (docs recommend ≤30s). */
export const MAX_CLIP_SECONDS = 30;

/**
 * Synchronous transcription of one short clip (≤30s) — used for live meeting
 * chunks and push-to-talk voice input. Returns "" when nothing was recognised.
 */
export async function transcribeClip(
  audio: { data: Buffer; filename: string; mimeType: string },
  languageCode: string,
): Promise<string> {
  const form = new FormData();
  form.append("audio_file", new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }), audio.filename);
  form.append("language_code", normalizeGnaniLanguage(languageCode));
  form.append("format", "transcribe");
  const data = await gnaniFetch<{ success?: boolean; transcript?: string }>("/stt/v3", { method: "POST", body: form }, { retryServerErrors: true });
  return (data.transcript ?? "").replace(/\s+/g, " ").trim();
}

// ── Text-to-speech ───────────────────────────────────────────────────────────

/** timbre-v3.0 voices speak every supported language; v2.5 voices are tied to one. */
const TTS_MODEL = "timbre-v3.0";
const TTS_VOICE_MALE = process.env.GNANI_VOICE_MALE?.trim() || "Prakash";
const TTS_VOICE_FEMALE = process.env.GNANI_VOICE_FEMALE?.trim() || "Lakshmi";

/** timbre-v3.0 voices (all speak every language), grouped by the voice's apparent gender. */
const MALE_POOL = [TTS_VOICE_MALE, "Avinash", "Shubham", "Devansh", "Yashraj", "Harshad", "Prakash"];
const FEMALE_POOL = [TTS_VOICE_FEMALE, "Shivani", "Kalpana", "Chetana", "Vasudha", "Riyaa", "Tarika", "Lakshmi"];

/**
 * Gnani voice for a speaker, chosen by pitch the same way stock voices are elsewhere. `nth` rotates
 * through the pool so two speakers with similar pitch don't end up with the same voice.
 */
export function gnaniVoiceForPitch(pitchHz: number, nth = 0): string {
  const pool = pitchHz >= 165 ? FEMALE_POOL : MALE_POOL;
  const unique = [...new Set(pool)];
  return unique[nth % unique.length]!;
}

/** App language codes → Gnani TTS language codes. Hinglish has its own code. */
export function gnaniTtsLanguage(code: string): string {
  if (code === "hinglish" || code === "hi-en") return "hi-en";
  if (code === "hi") return "hi-IN";
  if (code === "en") return "en-IN";
  const known: Record<string, string> = { ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", mr: "mr-IN", pa: "pa-IN", bn: "bn-IN", gu: "gu-IN" };
  return known[code] ?? ((GNANI_LANGUAGES as readonly string[]).includes(code) ? code : "en-IN");
}

/** Languages Gnani can speak. Dubbing targets outside this list stay on ElevenLabs. */
export function canGnaniSpeak(code: string): boolean {
  return ["hinglish", "hi-en", "hi", "en", "ta", "te", "kn", "ml", "mr", "pa", "bn", "gu"].includes(code) ||
    (GNANI_LANGUAGES as readonly string[]).includes(code);
}

export type GnaniSpeech = { audio: Buffer; mimeType: string };

/**
 * Speaks `text` with a Gnani voice. `speed` is Gnani's own pacing control (0.85–1.15), which is
 * how a phrase is fitted to its time slot without any alignment data.
 */
export async function synthesizeSpeech(input: {
  text: string;
  language: string;
  voice?: string;
  speed?: number;
  format?: "wav" | "mp3";
  /** Bulk work (dubbing a whole meeting) yields to live use of the same key. */
  priority?: GnaniPriority;
}): Promise<GnaniSpeech> {
  const format = input.format ?? "wav";
  const body = {
    text: input.text,
    model: TTS_MODEL,
    voice: input.voice ?? TTS_VOICE_MALE,
    language: gnaniTtsLanguage(input.language),
    speed: Math.min(1.15, Math.max(0.85, input.speed ?? 1)),
    audio_config: { container: format, sample_rate: 24000, num_channels: 1, sample_width: 2 },
  };
  for (let attempt = 0; ; attempt++) {
    type Outcome = { ok: true; speech: GnaniSpeech } | { ok: false; status: number; text: string };
    const outcome = await withGnaniSlot<Outcome>(async () => {
      const res = await fetch(`${GNANI_BASE_URL}/api/v1/tts/inference`, {
        method: "POST",
        headers: { "X-API-Key-ID": apiKey(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        return { ok: true, speech: { audio: Buffer.from(await res.arrayBuffer()), mimeType: format === "mp3" ? "audio/mpeg" : "audio/wav" } };
      }
      return { ok: false, status: res.status, text: await res.text().catch(() => "") };
    }, input.priority ?? "interactive");
    if (outcome.ok) return outcome.speech;

    // A 429 here means another process (e.g. a dev machine) holds the key's only slot — wait and retry.
    if ((outcome.status === 429 || outcome.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1) + Math.random() * 400));
      continue;
    }
    logger.warn("gnani.tts_failed", { status: outcome.status, body: outcome.text.slice(0, 400) });
    if (outcome.status === 401) throw serviceError("PRECONDITION_FAILED", "Gnani rejected the API key.");
    if (outcome.status === 402) throw serviceError("PRECONDITION_FAILED", "Out of Gnani credits.");
    if (outcome.status === 403) throw serviceError("PRECONDITION_FAILED", "Your Gnani key doesn't include text-to-speech.");
    if (outcome.status === 429) throw serviceError("INTERNAL", "Gnani is busy. Try again in a moment.");
    throw serviceError("INTERNAL", `Gnani text-to-speech failed (${outcome.status}).`);
  }
}

/**
 * Submits audio and starts transcription in one call. `languageCode` accepts a
 * single BCP-47 code, up to 3 comma-separated for language ID, or "auto".
 */
export async function submitMeetingAudio(
  audio: { data: Buffer; filename: string; mimeType: string },
  opts: { languageCode: string; diarization?: boolean; numSpeakers?: number },
): Promise<{ jobId: string }> {
  const config = {
    model: GNANI_MODEL,
    language_code: opts.languageCode,
    mode: "transcribe",
    with_diarization: opts.diarization ?? true,
    num_speakers: opts.numSpeakers ?? 8,
  };

  const form = new FormData();
  form.append("config", new Blob([JSON.stringify(config)], { type: "application/json" }));
  form.append("files", new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }), audio.filename);

  const created = await gnaniFetch<{ job_id: string; status: string }>(
    "/stt/v3/batch/jobs",
    { method: "POST", body: form },
    { priority: "bulk", timeoutMs: 120_000 },
  );

  await gnaniFetch(`/stt/v3/batch/jobs/${created.job_id}/start`, { method: "POST" }, { priority: "bulk" });

  return { jobId: created.job_id };
}

export async function getJobStatus(jobId: string): Promise<{ status: GnaniJobStatus }> {
  const data = await gnaniFetch<{ status: GnaniJobStatus }>(`/stt/v3/batch/jobs/${jobId}`, {}, { priority: "bulk", retryServerErrors: true });
  return { status: data.status };
}

type GnaniTranscriptFile = {
  full_transcript?: string;
  language_code?: string;
  duration_seconds?: number;
  segments?: Array<{ speaker_id?: string | number; start_time?: number; end_time?: number; text?: string }>;
};

/** Once a job is terminal, reads the transcript for its (single) submitted file. */
export async function fetchJobTranscript(
  jobId: string,
): Promise<{ transcript: string; segments: MeetingSegment[]; durationSeconds?: number } | null> {
  const files = await gnaniFetch<{ files?: Array<{ transcript_url?: string }> }>(
    `/stt/v3/batch/jobs/${jobId}/files?status=COMPLETED`,
    {},
    { priority: "bulk", retryServerErrors: true },
  );
  const transcriptUrl = files.files?.[0]?.transcript_url;
  if (!transcriptUrl) return null;

  const res = await fetch(transcriptUrl);
  if (!res.ok) throw serviceError("INTERNAL", `Could not download the Gnani transcript (${res.status}).`);
  const data = (await res.json()) as GnaniTranscriptFile;

  const segments: MeetingSegment[] = (data.segments ?? [])
    .filter((s) => s.text)
    .map((s) => ({
      speakerId: String(s.speaker_id ?? "1"),
      startTime: s.start_time ?? 0,
      endTime: s.end_time ?? 0,
      text: s.text!,
    }));

  return { transcript: data.full_transcript ?? "", segments, durationSeconds: data.duration_seconds };
}

const SPEAK_CHUNK_CHARS = 380;

/** Splits text into pieces Gnani handles comfortably, breaking at sentence ends where possible. */
export function splitForSpeech(text: string, maxChars = SPEAK_CHUNK_CHARS): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?।\n]+[.!?।]*\s*/g) ?? [];
  const pieces: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };
  for (const raw of sentences) {
    let sentence = raw;
    while (sentence.length > maxChars) {
      const cut = sentence.lastIndexOf(" ", maxChars);
      const at = cut > maxChars * 0.5 ? cut : maxChars;
      if ((current + sentence.slice(0, at)).length > maxChars) push();
      current += sentence.slice(0, at);
      push();
      sentence = sentence.slice(at);
    }
    if ((current + sentence).length > maxChars) push();
    current += sentence;
  }
  push();
  return pieces;
}

/** Reads text of any length: pieces are spoken one after another and joined into a single MP3. */
export async function speakText(input: { text: string; language: string; voice?: string; speed?: number }): Promise<GnaniSpeech> {
  const pieces = splitForSpeech(input.text);
  if (pieces.length === 0) throw serviceError("BAD_REQUEST", "Nothing to read.");
  const parts: Buffer[] = [];
  for (const piece of pieces) {
    parts.push((await synthesizeSpeech({ text: piece, language: input.language, voice: input.voice, speed: input.speed, format: "mp3" })).audio);
  }
  return { audio: Buffer.concat(parts), mimeType: "audio/mpeg" };
}
