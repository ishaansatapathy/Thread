/**
 * Opt-in audio retention for meetings, so a meeting can be dubbed after it ends. Clips are only
 * kept when the client sends X-Keep-Audio: 1 (the user ticked "Save audio for dubbing"), live in
 * the OS temp dir and are removed after RETENTION_MS or when the meeting is deleted.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { logger } from "@repo/logger";

import { f32ToWav16 } from "./dub-media";

export const MEETING_AUDIO_RETENTION_HOURS = 48;
const RETENTION_MS = MEETING_AUDIO_RETENTION_HOURS * 60 * 60 * 1000;
const RATE = 16000;
const baseDir = path.join(os.tmpdir(), "thread-meeting-audio");

export type SpeechSpan = { speaker: string; start: number; end: number };

function dirFor(meetingId: string) {
  return path.join(baseDir, meetingId.replace(/[^a-f0-9-]/gi, ""));
}

export function meetingWorkDir(meetingId: string) {
  return path.join(dirFor(meetingId), "work");
}

export async function saveMeetingClip(meetingId: string, clip: { wav: Buffer; startSeconds: number; speaker: string }) {
  const dir = dirFor(meetingId);
  await mkdir(dir, { recursive: true });
  const speaker = clip.speaker.replace(/[^a-z]/gi, "") || "room";
  await writeFile(path.join(dir, `${clip.startSeconds.toFixed(2)}_${speaker}.wav`), clip.wav);
}

async function clipFiles(meetingId: string) {
  const files = await readdir(dirFor(meetingId)).catch(() => [] as string[]);
  return files
    .map((f) => f.match(/^(\d+(?:\.\d+)?)_([a-z]+)\.wav$/i))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ file: m[0], start: Number(m[1]), speaker: m[2]! }));
}

export async function meetingAudioSeconds(meetingId: string): Promise<number> {
  const clips = await clipFiles(meetingId);
  let total = 0;
  for (const c of clips) {
    const size = (await stat(path.join(dirFor(meetingId), c.file)).catch(() => null))?.size ?? 0;
    total += Math.max(0, size - 44) / 2 / RATE;
  }
  return Math.round(total);
}

/** 16-bit mono 16 kHz PCM WAV (as the browser encodes clips) → float samples. Other formats → null. */
export function readPcm16(buf: Buffer): Float32Array | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.readUInt16LE(22) !== 1 || buf.readUInt16LE(34) !== 16) {
    return null;
  }
  if (buf.readUInt32LE(24) !== RATE) return null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      const end = Math.min(buf.length, offset + 8 + size);
      const out = new Float32Array(Math.floor((end - offset - 8) / 2));
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Lays every saved clip onto one timeline (clips from the mic and the meeting tab overlap in
 * time, so they are summed) and writes it as a single WAV. Returns where each speaker talked.
 */
export async function assembleMeetingAudio(meetingId: string): Promise<{ wavPath: string; seconds: number; spans: SpeechSpan[] } | null> {
  const clips = await clipFiles(meetingId);
  if (clips.length === 0) return null;
  const decoded: Array<{ start: number; speaker: string; pcm: Float32Array }> = [];
  for (const c of clips) {
    const pcm = readPcm16(await readFile(path.join(dirFor(meetingId), c.file)));
    if (pcm && pcm.length) decoded.push({ start: c.start, speaker: c.speaker, pcm });
  }
  if (decoded.length === 0) return null;

  const seconds = Math.max(...decoded.map((d) => d.start + d.pcm.length / RATE));
  const timeline = new Float32Array(Math.ceil(seconds * RATE) + 1);
  for (const d of decoded) {
    const from = Math.floor(d.start * RATE);
    for (let i = 0; i < d.pcm.length && from + i < timeline.length; i++) timeline[from + i]! += d.pcm[i]!;
  }
  for (let i = 0; i < timeline.length; i++) if (timeline[i]! > 1 || timeline[i]! < -1) timeline[i] = Math.tanh(timeline[i]!);

  const work = meetingWorkDir(meetingId);
  await mkdir(work, { recursive: true });
  const wavPath = path.join(work, "meeting.wav");
  await writeFile(wavPath, f32ToWav16(timeline, RATE));
  return {
    wavPath,
    seconds,
    spans: decoded.map((d) => ({ speaker: d.speaker, start: d.start, end: d.start + d.pcm.length / RATE })),
  };
}

export async function deleteMeetingAudio(meetingId: string) {
  await rm(dirFor(meetingId), { recursive: true, force: true });
}

async function sweepExpired() {
  const dirs = await readdir(baseDir).catch(() => [] as string[]);
  const now = Date.now();
  for (const d of dirs) {
    const info = await stat(path.join(baseDir, d)).catch(() => null);
    if (info && now - info.mtimeMs > RETENTION_MS) {
      await rm(path.join(baseDir, d), { recursive: true, force: true }).catch((error: unknown) =>
        logger.warn("meeting_audio.sweep_failed", { message: error instanceof Error ? error.message : String(error) }),
      );
    }
  }
}

setInterval(() => void sweepExpired(), 60 * 60 * 1000).unref();
