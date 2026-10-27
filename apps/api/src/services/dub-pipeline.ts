/**
 * Dub pipeline for one ingested video:
 * extract audio → word-timed STT (ElevenLabs Scribe; Gnani + pause detection as fallback)
 * → sentences split into pause-delimited chunks → per-sentence prosody → context-aware
 * translation split back into chunk-sized parts → voice clone per speaker → one natural TTS
 * take per sentence, cut at chunk boundaries and fitted into each chunk's original slot
 * → mix over the ducked original → mux into the video.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";

import type { DubJob } from "./dub";
import { jobDir } from "./dub";
import {
  ANALYSIS_RATE,
  MIX_RATE,
  TONE_VOICE_SETTINGS,
  analyzeLine,
  decodeToF32,
  detectSpeech,
  f32ToWav16,
  ffmpeg,
  tagTones,
  trimSilence,
  type Prosody,
  type Tone,
} from "./dub-media";
import { alignmentAnchors, envelope, envelopeCorrelation, uniformAnchors, warp } from "./dub-align";
import { buildContext, shortenSentence, translateSentences, type DubTargetCode, type SentenceInput } from "./dub-translate";
import {
  cloneVoice,
  deleteVoice,
  isElevenLabsConfigured,
  synthesizeWithTimestamps,
  transcribeWords,
  type ScribeWord,
} from "./elevenlabs";
import { isGnaniConfigured, transcribeClip } from "./gnani";

export type DubStage = "extracting" | "transcribing" | "analyzing" | "translating" | "cloning" | "voicing" | "mixing" | "done";

export type DubChunk = {
  start: number;
  end: number;
  source: string;
  text: string;
  /** Average speed applied to fit this chunk's slot (1 = untouched). */
  tempo: number | null;
  /** Loudness-rhythm correlation with the original after alignment (1 = identical). */
  sync: number | null;
  /** Same correlation with a plain uniform stretch, for comparison. */
  syncBefore: number | null;
};

export type DubLine = {
  id: number;
  speaker: string;
  start: number;
  end: number;
  original: string;
  resolved: string;
  translation: string;
  tone: Tone;
  prosody: Prosody;
  fixedByReview: boolean;
  chunks: DubChunk[];
};

export type DubRun = {
  status: "running" | "done" | "error";
  stage: DubStage;
  progress: { done: number; total: number } | null;
  target: DubTargetCode;
  sourceLanguage: string;
  transcriber: "scribe" | "gnani" | null;
  /** 0-100: how closely the dub's loudness rhythm follows the original speaker's. */
  syncScore: number | null;
  error: string | null;
  notice: string | null;
  lines: DubLine[];
  startedAt: number;
  finishedAt: number | null;
  outputPath: string | null;
  voiceIds: string[];
};

export const DUB_SOURCE_LANGUAGES = [
  { code: "hi-IN", label: "Hindi / Hinglish" },
  { code: "en-IN", label: "English" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "bn-IN", label: "Bengali" },
  { code: "mr-IN", label: "Marathi" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "pa-IN", label: "Punjabi" },
] as const;

export function isDubSourceLanguage(code: string) {
  return DUB_SOURCE_LANGUAGES.some((l) => l.code === code);
}

const MAX_CONCURRENT_RUNS = 2;
const STT_RATE = 16000;
const MIN_CLONE_SECONDS = 5;
const MAX_CLONE_SECONDS = 60;
const MAX_CLONED_SPEAKERS = 3;
/** Chunk boundaries: a pause at least this long splits a chunk. */
const CHUNK_PAUSE = 0.28;
const MAX_CHUNK_SECONDS = 6;
const MIN_CHUNK_SECONDS = 0.6;
/** Sentence boundaries: speaker change, end punctuation, or a pause this long. */
const SENTENCE_PAUSE = 1.0;
const MAX_SENTENCE_SECONDS = 18;
const MIN_TEMPO = 0.9;
const MAX_TEMPO = 1.3;
const HARD_MAX_TEMPO = 1.5;
const SHORTEN_ABOVE = 1.3;
/** Within this length ratio a phrase is warped onto the original rhythm; outside it, stretched uniformly. */
const WARP_MIN_SPEED = 0.7;
const WARP_MAX_SPEED = 1.45;
/** The original track still carries the speaker's voice, so it is muted wherever anyone speaks. */
const BG_GAIN_UNDER_SPEECH = 0;
const BG_GAIN_OPEN = 0.6;
const SPEECH_PAD_BEFORE = 0.2;
const SPEECH_PAD_AFTER = 0.35;

let runningRuns = 0;

export function assertCanDub() {
  if (!isElevenLabsConfigured()) throw new ServiceError("PRECONDITION_FAILED", "Dubbing needs ELEVENLABS_API_KEY on the server.");
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ServiceError("PRECONDITION_FAILED", "Dubbing needs OPENAI_API_KEY on the server.");
  if (runningRuns >= MAX_CONCURRENT_RUNS) {
    throw new ServiceError("BAD_REQUEST", "The dubbing studio is busy. Try again in a few minutes.");
  }
}

export function startDub(job: DubJob, target: DubTargetCode, sourceLanguage: string) {
  if (job.status !== "ready" || !job.filePath) throw new ServiceError("BAD_REQUEST", "The video isn't ready yet.");
  if (job.dub?.status === "running") throw new ServiceError("BAD_REQUEST", "This video is already being dubbed.");
  assertCanDub();

  const run: DubRun = {
    status: "running",
    stage: "extracting",
    progress: null,
    target,
    sourceLanguage,
    transcriber: null,
    syncScore: null,
    error: null,
    notice: null,
    lines: [],
    startedAt: Date.now(),
    finishedAt: null,
    outputPath: null,
    voiceIds: [],
  };
  job.dub = run;
  runningRuns++;

  void runPipeline(job, run)
    .then(() => {
      run.status = "done";
      run.stage = "done";
    })
    .catch((error) => {
      run.status = "error";
      run.error = error instanceof ServiceError ? error.message : "Dubbing failed. Try again.";
      logger.warn("dub.pipeline_failed", {
        jobId: job.id,
        stage: run.stage,
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(async () => {
      runningRuns--;
      run.finishedAt = Date.now();
      run.progress = null;
      await Promise.all(run.voiceIds.map((id) => deleteVoice(id)));
      run.voiceIds = [];
      const dir = jobDir(job.id);
      await Promise.all(["a16k.f32", "a8k.f32", "a44.f32", "mix.f32"].map((f) => rm(path.join(dir, f), { force: true })));
      await rm(path.join(dir, "tts"), { recursive: true, force: true });
    });
}

/** Premade ElevenLabs voices used when cloning isn't available on the account. */
function stockVoice(pitchHz: number): string {
  const male = process.env.ELEVENLABS_FALLBACK_VOICE_MALE?.trim() || "iP95p4xoKVk53GoZ742B";
  const female = process.env.ELEVENLABS_FALLBACK_VOICE_FEMALE?.trim() || "hpp4J3VqNfWAUOO0d1Us";
  return pitchHz >= 165 ? female : male;
}

type RawChunk = { start: number; end: number; text: string };
type RawSentence = { speaker: string; chunks: RawChunk[] };

function chunkWords(words: ScribeWord[]): RawChunk[] {
  const chunks: Array<{ words: ScribeWord[] }> = [];
  for (const w of words) {
    const last = chunks[chunks.length - 1];
    const prev = last?.words[last.words.length - 1];
    if (!last || !prev || w.start - prev.end >= CHUNK_PAUSE || w.end - last.words[0]!.start > MAX_CHUNK_SECONDS) {
      chunks.push({ words: [w] });
    } else {
      last.words.push(w);
    }
  }
  return mergeTinyChunks(
    chunks.map((c) => ({ start: c.words[0]!.start, end: c.words[c.words.length - 1]!.end, text: c.words.map((w) => w.text).join(" ") })),
  );
}

/** Folds chunks too short to voice on their own into the neighbour across the smaller gap. */
function mergeTinyChunks(chunks: RawChunk[]): RawChunk[] {
  const out = chunks.map((c) => ({ ...c }));
  for (let i = 0; i < out.length; ) {
    const c = out[i]!;
    if (out.length === 1 || c.end - c.start >= MIN_CHUNK_SECONDS) {
      i++;
      continue;
    }
    const prev = out[i - 1];
    const next = out[i + 1];
    const gapPrev = prev ? c.start - prev.end : Infinity;
    const gapNext = next ? next.start - c.end : Infinity;
    if (prev && gapPrev <= gapNext) {
      prev.end = c.end;
      prev.text = `${prev.text} ${c.text}`;
      out.splice(i, 1);
    } else if (next) {
      next.start = c.start;
      next.text = `${c.text} ${next.text}`;
      out.splice(i, 1);
    } else {
      i++;
    }
  }
  return out;
}

function sentencesFromWords(words: ScribeWord[]): RawSentence[] {
  const groups: Array<{ speaker: string; words: ScribeWord[] }> = [];
  for (const w of words) {
    const last = groups[groups.length - 1];
    const prev = last?.words[last.words.length - 1];
    const breakHere =
      !last ||
      !prev ||
      last.speaker !== w.speaker ||
      w.start - prev.end >= SENTENCE_PAUSE ||
      /[.?!।]$/.test(prev.text) ||
      w.end - last.words[0]!.start > MAX_SENTENCE_SECONDS;
    if (breakHere) groups.push({ speaker: w.speaker, words: [w] });
    else last.words.push(w);
  }
  return groups.map((g) => ({ speaker: g.speaker, chunks: chunkWords(g.words) }));
}

async function transcribeRegion(wav: Buffer, language: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transcribeClip({ data: wav, filename: "chunk.wav", mimeType: "audio/wav" }, language);
    } catch (error) {
      const retryable = error instanceof Error && /\((429|5\d\d)\)/.test(error.message);
      if (!retryable || attempt >= 4) throw error;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

/** Fallback when Scribe isn't available: our own pause detection gives the chunk timing, Gnani the text. */
async function sentencesViaGnani(run: DubRun, pcm16k: Float32Array): Promise<RawSentence[]> {
  if (!isGnaniConfigured()) throw new ServiceError("PRECONDITION_FAILED", "Speech-to-text isn't available (Scribe or Gnani).");
  const regions = detectSpeech(pcm16k, STT_RATE, MAX_CHUNK_SECONDS + 2, CHUNK_PAUSE);
  if (regions.length === 0) throw new ServiceError("BAD_REQUEST", "No speech was detected in this video.");
  const chunks: RawChunk[] = [];
  run.progress = { done: 0, total: regions.length };
  for (const [i, region] of regions.entries()) {
    const clip = pcm16k.subarray(Math.floor(region.start * STT_RATE), Math.ceil(region.end * STT_RATE));
    const text = await transcribeRegion(f32ToWav16(clip, STT_RATE), run.sourceLanguage);
    if (text.trim()) chunks.push({ start: region.start, end: region.end, text: text.trim() });
    run.progress = { done: i + 1, total: regions.length };
  }
  const merged = mergeTinyChunks(chunks);
  const sentences: RawSentence[] = [];
  for (const c of merged) {
    const last = sentences[sentences.length - 1];
    const prev = last?.chunks[last.chunks.length - 1];
    if (last && prev && c.start - prev.end < SENTENCE_PAUSE && c.end - last.chunks[0]!.start <= MAX_SENTENCE_SECONDS) {
      last.chunks.push(c);
    } else {
      sentences.push({ speaker: "speaker_0", chunks: [c] });
    }
  }
  return sentences;
}

async function transcribe(run: DubRun, pcm16k: Float32Array): Promise<RawSentence[]> {
  try {
    const { words } = await transcribeWords(
      { data: f32ToWav16(pcm16k, STT_RATE), filename: "audio.wav", mimeType: "audio/wav" },
      run.sourceLanguage.slice(0, 2),
    );
    if (words.length === 0) throw new ServiceError("BAD_REQUEST", "No speech was detected in this video.");
    run.transcriber = "scribe";
    return sentencesFromWords(words);
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== "PRECONDITION_FAILED") throw error;
    run.transcriber = "gnani";
    run.notice = `${error.message} Using Gnani with pause detection instead — timing is less precise.`;
    return sentencesViaGnani(run, pcm16k);
  }
}

function referenceAudio(lines: DubLine[], speaker: string, pcm: Float32Array): { wav: Buffer; seconds: number } {
  const parts: Float32Array[] = [];
  let seconds = 0;
  const spans = lines
    .filter((l) => l.speaker === speaker)
    .flatMap((l) => l.chunks)
    .sort((a, b) => b.end - b.start - (a.end - a.start));
  for (const span of spans) {
    if (seconds >= MAX_CLONE_SECONDS) break;
    const from = Math.floor(span.start * MIX_RATE);
    const to = Math.min(pcm.length, Math.ceil(span.end * MIX_RATE));
    if (to <= from) continue;
    parts.push(pcm.subarray(from, to));
    seconds += (to - from) / MIX_RATE;
  }
  const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    joined.set(p, offset);
    offset += p.length;
  }
  return { wav: f32ToWav16(joined, MIX_RATE), seconds };
}

type PlacedPiece = { at: number; pcm: Float32Array };

/** Cut times (seconds) between parts, taken from the TTS character alignment. */
function partCutTimes(parts: string[], charStarts: number[], charEnds: number[], totalSeconds: number): number[] {
  const text = parts.join(" ");
  const cuts: number[] = [];
  let offset = 0;
  const aligned = charStarts.length === text.length && charEnds.length === text.length;
  for (let i = 0; i < parts.length - 1; i++) {
    offset += parts[i]!.length + 1;
    if (aligned) {
      const prevEnd = charEnds[Math.max(0, offset - 2)] ?? 0;
      const nextStart = charStarts[offset] ?? prevEnd;
      cuts.push((prevEnd + Math.max(prevEnd, nextStart)) / 2);
    } else {
      cuts.push((offset / text.length) * totalSeconds);
    }
  }
  return cuts;
}

async function voiceSentence(
  run: DubRun,
  index: number,
  voiceId: string,
  ttsDir: string,
  input: SentenceInput,
  ctx: Awaited<ReturnType<typeof buildContext>>,
  nextSpeechStart: number,
  original: Float32Array,
): Promise<PlacedPiece[]> {
  const line = run.lines[index]!;
  const settings = TONE_VOICE_SETTINGS[line.tone];
  const slotTotal = line.chunks.reduce((a, c) => a + (c.end - c.start), 0);

  const take = async () => {
    const speech = await synthesizeWithTimestamps({
      voiceId,
      text: line.chunks.map((c) => c.text).join(" "),
      previousText: run.lines[index - 1]?.translation,
      nextText: run.lines[index + 1]?.translation,
      stability: settings.stability,
      style: settings.style,
    });
    const mp3 = path.join(ttsDir, `${line.id}.mp3`);
    await writeFile(mp3, speech.audio);
    const pcm = await decodeToF32(mp3, path.join(ttsDir, `${line.id}.f32`), MIX_RATE);
    return { pcm, speech };
  };

  let { pcm, speech } = await take();
  const spoken = () => {
    const [from, to] = trimSilence(pcm, MIX_RATE);
    return (to - from) / MIX_RATE;
  };
  const ratio = spoken() / Math.max(0.3, slotTotal);
  if (ratio > SHORTEN_ABOVE) {
    const shorter = await shortenSentence(input, { translation: line.translation, parts: line.chunks.map((c) => c.text) }, ctx, run.target, ratio);
    line.translation = shorter.translation;
    shorter.parts.forEach((p, i) => (line.chunks[i]!.text = p));
    ({ pcm, speech } = await take());
  }

  const totalSeconds = pcm.length / MIX_RATE;
  const cuts = partCutTimes(
    line.chunks.map((c) => c.text),
    speech.charStarts,
    speech.charEnds,
    totalSeconds,
  );
  const bounds = [0, ...cuts.map((t) => Math.round(t * MIX_RATE)), pcm.length];

  const pieces: PlacedPiece[] = [];
  for (const [i, chunk] of line.chunks.entries()) {
    const raw = pcm.subarray(bounds[i]!, Math.max(bounds[i]!, bounds[i + 1]!));
    const [from, to] = trimSilence(raw, MIX_RATE);
    let piece: Float32Array = raw.subarray(from, to);
    if (piece.length === 0) continue;

    const slot = Math.max(0.2, chunk.end - chunk.start);
    const nextStart = line.chunks[i + 1]?.start ?? nextSpeechStart;
    const available = Math.max(slot, nextStart - chunk.start - 0.03);
    const seconds = piece.length / MIX_RATE;
    const speed = seconds / slot;
    const origSpan = original.subarray(Math.floor(chunk.start * MIX_RATE), Math.ceil(chunk.end * MIX_RATE));
    const origEnv = envelope(origSpan, MIX_RATE);

    if (speed >= WARP_MIN_SPEED && speed <= WARP_MAX_SPEED && origEnv.length > 20) {
      // Close enough in length: warp the dub frame-by-frame onto the original's loudness rhythm.
      const anchors = alignmentAnchors(envelope(piece, MIX_RATE), origEnv);
      const uniform = warp(piece, MIX_RATE, uniformAnchors(seconds, slot), slot);
      piece = warp(piece, MIX_RATE, anchors, slot);
      chunk.tempo = Math.round(speed * 100) / 100;
      chunk.syncBefore = round2(envelopeCorrelation(envelope(uniform, MIX_RATE), origEnv));
      chunk.sync = round2(envelopeCorrelation(envelope(piece, MIX_RATE), origEnv));
    } else {
      let tempo = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, speed));
      if (seconds / tempo > available) tempo = Math.min(HARD_MAX_TEMPO, seconds / available);
      if (Math.abs(tempo - 1) > 0.02) {
        piece = warp(piece, MIX_RATE, uniformAnchors(seconds, seconds / tempo), seconds / tempo);
        chunk.tempo = Math.round(tempo * 100) / 100;
      }
      if (origEnv.length > 20) chunk.sync = round2(envelopeCorrelation(envelope(piece, MIX_RATE), origEnv));
    }

    const maxLen = Math.round(available * MIX_RATE);
    if (piece.length > maxLen) {
      piece = piece.slice(0, maxLen);
      const fade = Math.min(piece.length, Math.round(MIX_RATE * 0.03));
      for (let s = 0; s < fade; s++) piece[piece.length - 1 - s]! *= s / fade;
    }
    pieces.push({ at: chunk.start, pcm: piece });
  }
  return pieces;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function runPipeline(job: DubJob, run: DubRun) {
  const dir = jobDir(job.id);
  const source = job.filePath!;
  const duration = job.durationSeconds ?? 0;

  run.stage = "extracting";
  const pcm16k = await decodeToF32(source, path.join(dir, "a16k.f32"), STT_RATE);

  run.stage = "transcribing";
  const sentences = await transcribe(run, pcm16k);
  run.progress = null;

  run.stage = "analyzing";
  const analysis = await decodeToF32(source, path.join(dir, "a8k.f32"), ANALYSIS_RATE);
  const prosody = sentences.map((s) =>
    analyzeLine(analysis, s.chunks[0]!.start, s.chunks[s.chunks.length - 1]!.end, s.chunks.map((c) => c.text).join(" ")),
  );
  const tones = tagTones(prosody);
  run.lines = sentences.map((s, i) => ({
    id: i,
    speaker: s.speaker,
    start: round2(s.chunks[0]!.start),
    end: round2(s.chunks[s.chunks.length - 1]!.end),
    original: s.chunks.map((c) => c.text).join(" "),
    resolved: "",
    translation: "",
    tone: tones[i]!,
    prosody: prosody[i]!,
    fixedByReview: false,
    chunks: s.chunks.map((c) => ({
      start: round2(c.start),
      end: round2(c.end),
      source: c.text,
      text: "",
      tempo: null,
      sync: null,
      syncBefore: null,
    })),
  }));

  run.stage = "translating";
  run.progress = { done: 0, total: run.lines.length };
  const inputs: SentenceInput[] = run.lines.map((l) => ({
    id: l.id,
    speaker: l.speaker,
    tone: l.tone,
    chunks: l.chunks.map((c) => ({ text: c.source, seconds: c.end - c.start })),
  }));
  const ctx = await buildContext(inputs, run.target);
  const translated = await translateSentences(inputs, ctx, run.target, (done) => (run.progress = { done, total: run.lines.length }));
  for (const t of translated) {
    const line = run.lines[t.id]!;
    line.resolved = t.resolved;
    line.translation = t.translation;
    line.fixedByReview = t.fixedByReview;
    t.parts.forEach((p, i) => (line.chunks[i]!.text = p));
  }

  run.stage = "cloning";
  run.progress = null;
  const original = await decodeToF32(source, path.join(dir, "a44.f32"), MIX_RATE);
  const speechBySpeaker = new Map<string, number>();
  for (const l of run.lines) speechBySpeaker.set(l.speaker, (speechBySpeaker.get(l.speaker) ?? 0) + (l.end - l.start));
  const ranked = [...speechBySpeaker.entries()].sort((a, b) => b[1] - a[1]);
  const voiceBySpeaker = new Map<string, string>();
  for (const [speaker] of ranked.slice(0, MAX_CLONED_SPEAKERS)) {
    const ref = referenceAudio(run.lines, speaker, original);
    if (ref.seconds < MIN_CLONE_SECONDS) continue;
    try {
      const voiceId = await cloneVoice(`Thread dub ${job.id.slice(0, 8)} ${speaker}`, {
        data: ref.wav,
        filename: `${speaker}.wav`,
        mimeType: "audio/wav",
      });
      run.voiceIds.push(voiceId);
      voiceBySpeaker.set(speaker, voiceId);
    } catch (error) {
      if (!(error instanceof ServiceError && error.message.includes("paid ElevenLabs plan"))) throw error;
      const pitches = run.lines.filter((l) => l.speaker === speaker && l.prosody.pitchHz > 0).map((l) => l.prosody.pitchHz);
      voiceBySpeaker.set(speaker, stockVoice(pitches.reduce((a, b) => a + b, 0) / Math.max(1, pitches.length)));
      run.notice = "Using a stock voice: voice cloning needs a paid ElevenLabs plan (Starter or above).";
    }
  }
  const fallbackVoice = voiceBySpeaker.values().next().value;
  if (!fallbackVoice) {
    throw new ServiceError("BAD_REQUEST", `Need at least ${MIN_CLONE_SECONDS} seconds of clear speech to clone the voice.`);
  }

  run.stage = "voicing";
  const ttsDir = path.join(dir, "tts");
  await mkdir(ttsDir, { recursive: true });
  const placed: PlacedPiece[][] = new Array(run.lines.length);
  let done = 0;
  run.progress = { done, total: run.lines.length };
  await mapLimit(run.lines, 3, async (line, i) => {
    const nextSpeechStart = run.lines[i + 1]?.start ?? Math.max(duration, line.end + 1);
    placed[i] = await voiceSentence(
      run,
      i,
      voiceBySpeaker.get(line.speaker) ?? fallbackVoice,
      ttsDir,
      inputs[i]!,
      ctx,
      nextSpeechStart,
      original,
    );
    run.progress = { done: ++done, total: run.lines.length };
  });
  const scored = run.lines.flatMap((l) => l.chunks).filter((c) => c.sync !== null);
  run.syncScore = scored.length
    ? Math.round((scored.reduce((a, c) => a + Math.max(0, c.sync!), 0) / scored.length) * 100)
    : null;

  run.stage = "mixing";
  run.progress = null;
  const total = Math.max(original.length, Math.ceil(duration * MIX_RATE));
  const mix = new Float32Array(total);
  const speech = new Uint8Array(total);
  for (const piece of placed.flat()) {
    const from = Math.floor(piece.at * MIX_RATE);
    for (let s = 0; s < piece.pcm.length && from + s < total; s++) {
      mix[from + s]! += piece.pcm[s]!;
      speech[from + s] = 1;
    }
  }
  // Mute the original across each whole sentence (padded for breaths and trailing syllables) so its voice never bleeds through.
  for (const line of run.lines) {
    const from = Math.max(0, Math.floor((line.start - SPEECH_PAD_BEFORE) * MIX_RATE));
    speech.fill(1, from, Math.min(total, Math.ceil((line.end + SPEECH_PAD_AFTER) * MIX_RATE)));
  }

  // One-pole smoothing (~60ms) so the background fades instead of clicking at chunk boundaries.
  const smoothing = 1 - Math.exp(-1 / (0.06 * MIX_RATE));
  let gain = BG_GAIN_OPEN;
  for (let s = 0; s < total; s++) {
    gain += ((speech[s] ? BG_GAIN_UNDER_SPEECH : BG_GAIN_OPEN) - gain) * smoothing;
    const value = mix[s]! + (original[s] ?? 0) * gain;
    mix[s] = value > 1 || value < -1 ? Math.tanh(value) : value;
  }

  const mixPath = path.join(dir, "mix.f32");
  await writeFile(mixPath, Buffer.from(mix.buffer, mix.byteOffset, mix.byteLength));
  const output = path.join(dir, `dubbed-${run.target}.mp4`);
  const audioArgs = ["-f", "f32le", "-ar", String(MIX_RATE), "-ac", "1", "-i", mixPath];
  const tail = ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", output];
  try {
    await ffmpeg(["-i", source, ...audioArgs, "-c:v", "copy", ...tail]);
  } catch {
    await ffmpeg(["-i", source, ...audioArgs, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", ...tail]);
  }
  run.outputPath = output;
}
