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

async function gnaniFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GNANI_BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), "X-API-Key-ID": apiKey() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn("gnani.request_failed", { path, status: res.status, body: text.slice(0, 500) });
    if (res.status === 401) throw serviceError("PRECONDITION_FAILED", "Gnani rejected the API key.");
    throw serviceError("INTERNAL", `Gnani request failed (${res.status}).`);
  }
  return (await res.json()) as T;
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
  const data = await gnaniFetch<{ success?: boolean; transcript?: string }>("/stt/v3", { method: "POST", body: form });
  return (data.transcript ?? "").replace(/\s+/g, " ").trim();
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

  const created = await gnaniFetch<{ job_id: string; status: string }>("/stt/v3/batch/jobs", {
    method: "POST",
    body: form,
  });

  await gnaniFetch(`/stt/v3/batch/jobs/${created.job_id}/start`, { method: "POST" });

  return { jobId: created.job_id };
}

export async function getJobStatus(jobId: string): Promise<{ status: GnaniJobStatus }> {
  const data = await gnaniFetch<{ status: GnaniJobStatus }>(`/stt/v3/batch/jobs/${jobId}`);
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
