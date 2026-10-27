/**
 * ffmpeg/ffprobe helpers and per-line prosody analysis (pitch, loudness, speaking rate)
 * for the dub pipeline. Audio is analysed as raw float32 PCM, so no native deps.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { ServiceError } from "@repo/services/errors";

const FFMPEG = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH?.trim() || "ffprobe";
export const ANALYSIS_RATE = 8000;
export const MIX_RATE = 44100;

export function runProcess(
  command: string,
  args: string[],
  timeoutMs = 10 * 60 * 1000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function ffmpeg(args: string[]): Promise<void> {
  let result;
  try {
    result = await runProcess(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ServiceError("PRECONDITION_FAILED", "Dubbing needs ffmpeg installed on the server (or set FFMPEG_PATH).");
    }
    throw error;
  }
  if (result.code !== 0) throw new Error(`ffmpeg failed: ${result.stderr.slice(-600)}`);
}

export async function probeDuration(filePath: string): Promise<number> {
  let result;
  try {
    result = await runProcess(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath], 60_000);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ServiceError("PRECONDITION_FAILED", "Dubbing needs ffprobe installed on the server (or set FFPROBE_PATH).");
    }
    throw error;
  }
  const seconds = Number.parseFloat(result.stdout.trim());
  if (result.code !== 0 || !Number.isFinite(seconds)) throw new Error(`ffprobe failed: ${result.stderr.slice(-300)}`);
  return seconds;
}

/** Decodes any audio/video file to mono float32 PCM at `rate`. */
export async function decodeToF32(input: string, rawOut: string, rate: number): Promise<Float32Array> {
  await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", rawOut]);
  const buf = await readFile(rawOut);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/** Index range of `pcm` without leading/trailing silence (keeps ~20ms of padding). */
export function trimSilence(pcm: Float32Array, rate: number, thresholdDb = -42): [number, number] {
  const win = Math.max(1, Math.round(rate * 0.01));
  const loud = (i: number) => {
    let sum = 0;
    const end = Math.min(pcm.length, i + win);
    for (let j = i; j < end; j++) sum += pcm[j]! * pcm[j]!;
    return 10 * Math.log10(sum / Math.max(1, end - i) + 1e-12) > thresholdDb;
  };
  let from = 0;
  while (from < pcm.length && !loud(from)) from += win;
  let to = pcm.length;
  while (to > from && !loud(Math.max(from, to - win))) to -= win;
  const pad = Math.round(rate * 0.02);
  return [Math.max(0, from - pad), Math.min(pcm.length, to + pad)];
}

export function f32ToWav16(samples: Float32Array, rate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataBytes = samples.length * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  const data = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return Buffer.concat([header, data]);
}

export type SpeechRegion = { start: number; end: number };

/**
 * Energy-based voice activity detection. Returns speech regions no longer than `maxSeconds`;
 * long stretches are split at the quietest frame so clips rarely cut mid-word.
 */
export function detectSpeech(samples: Float32Array, rate: number, maxSeconds = 25, mergeGapSeconds = 0.35): SpeechRegion[] {
  const step = 0.02;
  const frame = Math.round(rate * step);
  const frames = Math.floor(samples.length / frame);
  if (frames === 0) return [];
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += samples[i]! * samples[i]!;
    db[f] = 10 * Math.log10(sum / frame + 1e-12);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(frames * 0.1)]!;
  const peak = sorted[Math.floor(frames * 0.95)]!;
  const threshold = Math.max(-50, floor + Math.min(12, (peak - floor) * 0.35));

  const raw: Array<[number, number]> = [];
  let start = -1;
  for (let f = 0; f < frames; f++) {
    const voiced = db[f]! > threshold;
    if (voiced && start < 0) start = f;
    if (!voiced && start >= 0) {
      raw.push([start, f]);
      start = -1;
    }
  }
  if (start >= 0) raw.push([start, frames]);

  const maxGap = Math.round(mergeGapSeconds / step);
  const merged: Array<[number, number]> = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= maxGap) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }

  const maxFrames = Math.round(maxSeconds / step);
  const minSplit = Math.round((maxSeconds * 0.5) / step);
  const split: Array<[number, number]> = [];
  for (const [s, e] of merged) {
    let cur = s;
    while (e - cur > maxFrames) {
      let cut = cur + maxFrames;
      for (let f = cur + minSplit; f < cur + maxFrames; f++) if (db[f]! < db[cut]!) cut = f;
      split.push([cur, cut]);
      cur = cut;
    }
    split.push([cur, e]);
  }

  const pad = 0.15;
  const total = samples.length / rate;
  return split
    .filter(([s, e]) => (e - s) * step >= 0.4)
    .map(([s, e]) => ({ start: Math.max(0, s * step - pad), end: Math.min(total, e * step + pad) }));
}

export type Tone = "excited" | "calm" | "serious" | "neutral";

export type Prosody = {
  /** Median voiced pitch in Hz (0 when no voiced frames). */
  pitchHz: number;
  /** Pitch movement in semitones (std dev) — how expressive/melodic the line is. */
  pitchRangeSt: number;
  /** RMS loudness in dBFS. */
  loudnessDb: number;
  wordsPerSecond: number;
};

const FRAME = 320;
const HOP = 160;
const MIN_LAG = Math.floor(ANALYSIS_RATE / 400);
const MAX_LAG = Math.ceil(ANALYSIS_RATE / 70);

function framePitch(samples: Float32Array, start: number): number {
  let energy = 0;
  for (let i = 0; i < FRAME; i++) energy += samples[start + i]! * samples[start + i]!;
  if (energy / FRAME < 1e-5) return 0;

  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
    let corr = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < FRAME - lag; i++) {
      const a = samples[start + i]!;
      const b = samples[start + i + lag]!;
      corr += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const norm = corr / Math.sqrt(e1 * e2 + 1e-12);
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }
  return bestCorr > 0.55 && bestLag > 0 ? ANALYSIS_RATE / bestLag : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function analyzeLine(samples: Float32Array, startSec: number, endSec: number, text: string): Prosody {
  const from = Math.max(0, Math.floor(startSec * ANALYSIS_RATE));
  const to = Math.min(samples.length - FRAME, Math.floor(endSec * ANALYSIS_RATE));
  const pitches: number[] = [];
  let sumSq = 0;
  let count = 0;
  for (let pos = from; pos < to; pos += HOP) {
    const f0 = framePitch(samples, pos);
    if (f0 > 0) pitches.push(f0);
  }
  for (let i = from; i < Math.min(to + FRAME, samples.length); i++) {
    sumSq += samples[i]! * samples[i]!;
    count++;
  }

  const pitchHz = median(pitches);
  let pitchRangeSt = 0;
  if (pitches.length > 2 && pitchHz > 0) {
    const st = pitches.map((p) => 12 * Math.log2(p / pitchHz));
    const mean = st.reduce((a, b) => a + b, 0) / st.length;
    pitchRangeSt = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length);
  }
  const rms = Math.sqrt(sumSq / Math.max(1, count));
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    pitchHz: Math.round(pitchHz),
    pitchRangeSt: Math.round(pitchRangeSt * 100) / 100,
    loudnessDb: Math.round(20 * Math.log10(rms + 1e-9) * 10) / 10,
    wordsPerSecond: Math.round((words / Math.max(0.3, endSec - startSec)) * 100) / 100,
  };
}

/** Tags each line relative to the speaker's own baseline, so a naturally loud speaker isn't always "excited". */
export function tagTones(lines: Prosody[]): Tone[] {
  const base = {
    loud: median(lines.map((l) => l.loudnessDb)),
    range: median(lines.map((l) => l.pitchRangeSt)),
    rate: median(lines.map((l) => l.wordsPerSecond)),
    pitch: median(lines.filter((l) => l.pitchHz > 0).map((l) => l.pitchHz)),
  };
  return lines.map((l) => {
    const louder = l.loudnessDb - base.loud;
    const moreMelodic = l.pitchRangeSt - base.range;
    const faster = base.rate > 0 ? l.wordsPerSecond / base.rate : 1;
    const higher = base.pitch > 0 && l.pitchHz > 0 ? 12 * Math.log2(l.pitchHz / base.pitch) : 0;
    if ((louder > 3 && (moreMelodic > 0.5 || higher > 1.5)) || (faster > 1.25 && louder > 1.5)) return "excited";
    if (louder < -4 && faster < 0.9) return "calm";
    if (moreMelodic < -0.6 && Math.abs(louder) <= 3) return "serious";
    return "neutral";
  });
}

export const TONE_VOICE_SETTINGS: Record<Tone, { stability: number; style: number }> = {
  excited: { stability: 0.3, style: 0.45 },
  calm: { stability: 0.65, style: 0.1 },
  serious: { stability: 0.6, style: 0.2 },
  neutral: { stability: 0.45, style: 0.25 },
};
