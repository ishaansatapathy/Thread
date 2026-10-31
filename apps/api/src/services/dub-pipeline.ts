/**
 * Dub pipeline for one recording (a meeting's saved audio):
 * word-timed STT (ElevenLabs Scribe; Gnani + pause detection as fallback) → sentences split into
 * pause-delimited chunks → per-sentence prosody → context-aware translation split back into
 * chunk-sized parts → one natural TTS take per sentence in the speaker's chosen voice, cut at chunk
 * boundaries and fitted into each chunk's original slot, then matched to the original phrase's
 * pitch and loudness → mixed over the original's non-speech audio → one audio file.
 * Only audio is produced; nothing visual is ever generated or altered.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";

import {
  ANALYSIS_RATE,
  MIX_RATE,
  TONE_VOICE_SETTINGS,
  analyzeLine,
  decodeToF32,
  resampleBy,
  rmsDb,
  detectSpeech,
  f32ToWav16,
  ffmpeg,
  tagTones,
  trimSilence,
  type Prosody,
  type Tone,
} from "./dub-media";
import {
  MAX_LOCAL_RATE,
  MIN_LOCAL_RATE,
  alignmentAnchors,
  envelope,
  envelopeCorrelation,
  segmentRates,
  uniformAnchors,
  warp,
} from "./dub-align";
import { buildContext, shortenSentence, translateSentences, type DubTargetCode, type SentenceInput } from "./dub-translate";
import { isElevenLabsConfigured, synthesizeWithTimestamps, transcribeWords, type ScribeWord } from "./elevenlabs";
import { isGnaniConfigured, transcribeClip } from "./gnani";

export type DubStage = "extracting" | "transcribing" | "analyzing" | "translating" | "voices" | "voicing" | "mixing" | "done";

/** What to dub and how each speaker should sound. */
export type DubSource = {
  id: string;
  /** Scratch directory for intermediate files (cleaned up after the run). */
  dir: string;
  sourcePath: string;
  durationSeconds: number;
  /** Who is speaking in [start, end] when the caller knows better than diarization (e.g. mic vs. tab). */
  speakerAt?: (start: number, end: number) => string | null;
  /** Voice id for a speaker; their median pitch helps pick a matching stock voice. */
  voiceFor: (speaker: string, pitchHz: number) => Promise<{ voiceId: string; notice?: string }>;
};

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
  /** Seconds this phrase starts after the original (the previous phrase ran long). */
  delay: number;
  /** Seconds cut from the end because the next speaker starts (should stay 0). */
  clipped: number;
  /** Semitones the dub was moved to follow the original phrase's intonation. */
  pitchShift: number;
  /** Gain applied so the dub follows the original phrase's loudness. */
  gainDb: number;
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
/** Chunk boundaries: a pause at least this long splits a chunk. */
const CHUNK_PAUSE = 0.28;
const MAX_CHUNK_SECONDS = 6;
const MIN_CHUNK_SECONDS = 0.6;
/** Sentence boundaries: speaker change, end punctuation, or a pause this long. */
const SENTENCE_PAUSE = 1.0;
const MAX_SENTENCE_SECONDS = 18;
/** Only used when a phrase would otherwise be cut off before the next speaker starts. */
const HARD_MAX_TEMPO = 1.3;
/** Breath left between phrases when one is pushed back by the previous. */
const PHRASE_GAP = 0.04;
/** ElevenLabs' own speaking-rate range we allow; the model sounds natural inside it. */
const MIN_MODEL_SPEED = 0.85;
const MAX_MODEL_SPEED = 1.15;
/** A take more than this far from the sentence's length is redone at a corrected model speed. */
const RETAKE_TOLERANCE = 0.08;
/** Above this, the translation is shortened rather than spoken faster. */
const SHORTEN_ABOVE = 1.12;

type Pace = { chars: number; seconds: number };

function clampSpeed(speed: number) {
  return Math.min(MAX_MODEL_SPEED, Math.max(MIN_MODEL_SPEED, speed));
}
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

/** Starts a dub in the background; the returned run is updated in place as it progresses. */
export function startDub(source: DubSource, target: DubTargetCode, sourceLanguage: string): DubRun {
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
  };
  runningRuns++;

  void runPipeline(source, run)
    .then(() => {
      run.status = "done";
      run.stage = "done";
    })
    .catch((error) => {
      run.status = "error";
      run.error = error instanceof ServiceError ? error.message : "Dubbing failed. Try again.";
      logger.warn("dub.pipeline_failed", {
        sourceId: source.id,
        stage: run.stage,
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(async () => {
      runningRuns--;
      run.finishedAt = Date.now();
      run.progress = null;
      await Promise.all(
        ["a16k.f32", "a8k.f32", "a44.f32", "mix.f32"].map((f) => rm(path.join(source.dir, f), { force: true })),
      );
      await rm(path.join(source.dir, "tts"), { recursive: true, force: true });
    });
  return run;
}

/** The speaker's typical pitch and loudness, so each phrase can be compared against it. */
type SpeakerBaseline = { pitchHz: number; loudnessDb: number };

/** Largest intonation shift applied to a dubbed phrase; bigger shifts start to sound processed. */
const MAX_PITCH_SHIFT_ST = 2;
/** Pitch differences beyond this are almost always octave errors in detection, not intonation. */
const PITCH_TRUST_LIMIT_ST = 5;
/** Share of the measured intonation difference to carry over (pitch tracking on short phrases is noisy). */
const PITCH_TRANSFER = 0.7;
const MAX_GAIN_DB = 6;
/** Typical level of ElevenLabs speech; dubbed phrases are set relative to it. */
const DUB_REFERENCE_DB = -20;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Carries the original phrase's intonation and energy onto the dubbed phrase: if the speaker said
 * this phrase higher or louder than they usually talk, the dub is raised by the same amount.
 * Pitch is moved without changing duration (resample + WSOLA back to length).
 */
function matchProsody(piece: Float32Array, chunk: DubChunk, analysis: Float32Array, baseline: SpeakerBaseline): Float32Array {
  const orig = analyzeLine(analysis, chunk.start, chunk.end, chunk.source);
  const dub = analyzeLine(resampleBy(piece, MIX_RATE / ANALYSIS_RATE), 0, piece.length / MIX_RATE, chunk.text);
  let out = piece;

  if (orig.pitchHz > 0 && dub.pitchHz > 0 && baseline.pitchHz > 0) {
    // Target: the dub sits above/below the speaker's usual pitch exactly as much as the original did.
    const wanted = 12 * Math.log2(orig.pitchHz / baseline.pitchHz);
    const current = 12 * Math.log2(dub.pitchHz / baseline.pitchHz);
    const diff = wanted - current;
    const shift = Math.max(-MAX_PITCH_SHIFT_ST, Math.min(MAX_PITCH_SHIFT_ST, diff * PITCH_TRANSFER));
    if (Math.abs(diff) <= PITCH_TRUST_LIMIT_ST && Math.abs(shift) >= 0.3) {
      const ratio = 2 ** (shift / 12);
      const seconds = out.length / MIX_RATE;
      const raised = resampleBy(out, ratio);
      out = warp(raised, MIX_RATE, uniformAnchors(raised.length / MIX_RATE, seconds), seconds);
      chunk.pitchShift = round2(shift);
    }
  }

  const relative = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, orig.loudnessDb - baseline.loudnessDb));
  const gainDb = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, DUB_REFERENCE_DB + relative - rmsDb(out)));
  if (Math.abs(gainDb) >= 0.5) {
    const gain = 10 ** (gainDb / 20);
    if (out === piece) out = piece.slice();
    for (let i = 0; i < out.length; i++) out[i]! *= gain;
    chunk.gainDb = round2(gainDb);
  }
  return out;
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
  if (regions.length === 0) throw new ServiceError("BAD_REQUEST", "No speech was detected in this recording.");
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
      /^[a-z]{2}-/i.test(run.sourceLanguage) ? run.sourceLanguage.slice(0, 2) : null,
    );
    if (words.length === 0) throw new ServiceError("BAD_REQUEST", "No speech was detected in this recording.");
    run.transcriber = "scribe";
    return sentencesFromWords(words);
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== "PRECONDITION_FAILED") throw error;
    run.transcriber = "gnani";
    run.notice = `${error.message} Using Gnani with pause detection instead — timing is less precise.`;
    return sentencesViaGnani(run, pcm16k);
  }
}

type PlacedPiece = { at: number; pcm: Float32Array };

/**
 * Where to cut one TTS take into per-chunk pieces. Each cut lands on a word gap: the translator's
 * suggested boundary when it falls near the time the original speaker reached that chunk, otherwise
 * the word gap closest to that time — so no piece ends up far too long or short for its slot.
 * Returns cut times (seconds) and the words that ended up in each piece.
 */
function chooseCuts(
  parts: string[],
  speech: { charStarts: number[]; charEnds: number[] },
  takeStart: number,
  takeEnd: number,
  line: DubLine,
): { cuts: number[]; texts: string[] } {
  const text = parts.join(" ");
  const n = parts.length;
  if (n <= 1) return { cuts: [], texts: [text] };
  const { charStarts, charEnds } = speech;
  if (charStarts.length !== text.length || charEnds.length !== text.length) {
    const cuts: number[] = [];
    let offset = 0;
    for (let i = 0; i < n - 1; i++) {
      offset += parts[i]!.length + 1;
      cuts.push(takeStart + (offset / text.length) * (takeEnd - takeStart));
    }
    return { cuts, texts: parts };
  }

  const gaps: Array<{ index: number; time: number }> = [];
  for (let k = 1; k < text.length - 1; k++) {
    if (text[k] === " " && text[k - 1] !== " ") {
      gaps.push({ index: k, time: (charEnds[k - 1]! + Math.max(charEnds[k - 1]!, charStarts[k + 1]!)) / 2 });
    }
  }
  const span = Math.max(0.3, line.end - line.start);
  const chosen: number[] = [];
  let suggested = 0;
  let minGap = 0;
  for (let b = 1; b < n; b++) {
    suggested += parts[b - 1]!.length + 1;
    const target = takeStart + ((line.chunks[b]!.start - line.start) / span) * (takeEnd - takeStart);
    const tolerance = Math.max(0.35, 0.2 * (line.chunks[b - 1]!.end - line.chunks[b - 1]!.start));
    const remaining = gaps.filter((g, gi) => gi >= minGap && gaps.length - gi >= n - b);
    if (remaining.length === 0) break;
    const llm = remaining.find((g) => g.index === suggested - 1);
    const pick =
      llm && Math.abs(llm.time - target) <= tolerance
        ? llm
        : remaining.reduce((best, g) => (Math.abs(g.time - target) < Math.abs(best.time - target) ? g : best));
    chosen.push(pick.index);
    minGap = gaps.indexOf(pick) + 1;
  }
  if (chosen.length !== n - 1) {
    return { cuts: [], texts: [text] };
  }
  const bounds = [-1, ...chosen, text.length];
  return {
    cuts: chosen.map((idx) => gaps.find((g) => g.index === idx)!.time),
    texts: bounds.slice(1).map((end, i) => text.slice(bounds[i]! + 1, end).trim()),
  };
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
  pace: Pace,
  analysis: Float32Array,
  baseline: SpeakerBaseline,
): Promise<PlacedPiece[]> {
  const line = run.lines[index]!;
  const settings = TONE_VOICE_SETTINGS[line.tone];
  // The take includes the speaker's own pauses, so it is compared against the whole sentence span.
  const span = Math.max(0.3, line.end - line.start);
  const text = () => line.chunks.map((c) => c.text).join(" ");

  const take = async (speed: number) => {
    const speech = await synthesizeWithTimestamps({
      voiceId,
      text: text(),
      previousText: run.lines[index - 1]?.translation,
      nextText: run.lines[index + 1]?.translation,
      stability: settings.stability,
      style: settings.style,
      speed,
    });
    const mp3 = path.join(ttsDir, `${line.id}.mp3`);
    await writeFile(mp3, speech.audio);
    const pcm = await decodeToF32(mp3, path.join(ttsDir, `${line.id}.f32`), MIX_RATE);
    const [from, to] = trimSilence(pcm, MIX_RATE);
    const spoken = (to - from) / MIX_RATE;
    pace.chars += text().length;
    pace.seconds += spoken * speed;
    return { pcm, speech, ratio: spoken / span };
  };

  // Pre-fit: predict this voice's natural length from earlier takes and ask the model to pace itself.
  let speed = clampSpeed(pace.seconds > 2 ? (text().length * (pace.seconds / pace.chars)) / span : 1);
  let { pcm, speech, ratio } = await take(speed);

  if (ratio > SHORTEN_ABOVE && speed * ratio > MAX_MODEL_SPEED) {
    const shorter = await shortenSentence(
      input,
      { translation: line.translation, parts: line.chunks.map((c) => c.text) },
      ctx,
      run.target,
      (speed * ratio) / MAX_MODEL_SPEED,
    );
    line.translation = shorter.translation;
    shorter.parts.forEach((p, i) => (line.chunks[i]!.text = p));
    ({ pcm, speech, ratio } = await take(speed));
  }
  if (ratio > 1 + RETAKE_TOLERANCE || ratio < 1 - RETAKE_TOLERANCE) {
    const better = clampSpeed(speed * ratio);
    if (Math.abs(better - speed) > 0.03) {
      speed = better;
      ({ pcm, speech, ratio } = await take(speed));
    }
  }

  const [speechFrom, speechTo] = trimSilence(pcm, MIX_RATE);
  const split = chooseCuts(line.chunks.map((c) => c.text), speech, speechFrom / MIX_RATE, speechTo / MIX_RATE, line);
  if (split.cuts.length === line.chunks.length - 1) {
    split.texts.forEach((t, i) => (line.chunks[i]!.text = t));
  } else {
    // Not enough word gaps to split: voice the whole sentence as one phrase from the first chunk.
    const first = line.chunks[0]!;
    const last = line.chunks[line.chunks.length - 1]!;
    line.chunks = [{ ...first, end: last.end, source: line.original, text: line.chunks.map((c) => c.text).join(" ") }];
  }
  const bounds = [0, ...split.cuts.map((t) => Math.round(t * MIX_RATE)), pcm.length];

  const pieces: PlacedPiece[] = [];
  // End of the previous phrase as placed; a phrase that ran long pushes the next one back
  // (into the speaker's pause) instead of being cut off mid-word.
  let cursor = 0;
  for (const [i, chunk] of line.chunks.entries()) {
    const raw = pcm.subarray(bounds[i]!, Math.max(bounds[i]!, bounds[i + 1]!));
    const [from, to] = trimSilence(raw, MIX_RATE);
    let piece: Float32Array = raw.subarray(from, to);
    if (piece.length === 0) continue;

    const at = Math.max(chunk.start, cursor + PHRASE_GAP);
    chunk.delay = round2(at - chunk.start);
    const isLast = i === line.chunks.length - 1;
    const slot = Math.max(0.2, chunk.end - at);
    const nextStart = isLast ? nextSpeechStart : line.chunks[i + 1]!.start;
    // Within a sentence a long phrase may run on; at the sentence end it must finish before the next speaker.
    const available = isLast ? Math.max(slot, nextStart - at - 0.03) : Infinity;
    const seconds = piece.length / MIX_RATE;
    const speed = seconds / slot;
    const origSpan = original.subarray(Math.floor(chunk.start * MIX_RATE), Math.ceil(chunk.end * MIX_RATE));
    const origEnv = envelope(origSpan, MIX_RATE);
    const onTime = chunk.delay === 0;

    if (onTime && speed >= MIN_LOCAL_RATE && speed <= MAX_LOCAL_RATE && origEnv.length > 20) {
      // Close enough in length: warp the dub frame-by-frame onto the original's loudness rhythm.
      const anchors = alignmentAnchors(envelope(piece, MIX_RATE), origEnv);
      const uniform = warp(piece, MIX_RATE, uniformAnchors(seconds, slot), slot);
      piece = warp(piece, MIX_RATE, anchors, slot);
      chunk.tempo = round2(Math.max(...segmentRates(anchors)));
      chunk.syncBefore = round2(envelopeCorrelation(envelope(uniform, MIX_RATE), origEnv));
      chunk.sync = round2(envelopeCorrelation(envelope(piece, MIX_RATE), origEnv));
    } else {
      // Too far off to warp naturally: a gentle uniform change, spilling into the following pause if needed.
      let tempo = Math.min(MAX_LOCAL_RATE, Math.max(onTime ? MIN_LOCAL_RATE : 1, speed));
      if (seconds / tempo > available) tempo = Math.min(HARD_MAX_TEMPO, seconds / available);
      if (Math.abs(tempo - 1) > 0.02) {
        piece = warp(piece, MIX_RATE, uniformAnchors(seconds, seconds / tempo), seconds / tempo);
      }
      chunk.tempo = round2(tempo);
      if (origEnv.length > 20) chunk.sync = round2(envelopeCorrelation(envelope(piece, MIX_RATE), origEnv));
    }

    piece = matchProsody(piece, chunk, analysis, baseline);

    const maxLen = Math.round(available * MIX_RATE);
    if (piece.length > maxLen) {
      chunk.clipped = round2((piece.length - maxLen) / MIX_RATE);
      piece = piece.slice(0, maxLen);
      const fade = Math.min(piece.length, Math.round(MIX_RATE * 0.03));
      for (let s = 0; s < fade; s++) piece[piece.length - 1 - s]! *= s / fade;
    }
    pieces.push({ at, pcm: piece });
    cursor = at + piece.length / MIX_RATE;
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

async function runPipeline(src: DubSource, run: DubRun) {
  const dir = src.dir;
  const source = src.sourcePath;
  const duration = src.durationSeconds;
  await mkdir(dir, { recursive: true });

  run.stage = "extracting";
  const pcm16k = await decodeToF32(source, path.join(dir, "a16k.f32"), STT_RATE);

  run.stage = "transcribing";
  const sentences = await transcribe(run, pcm16k);
  run.progress = null;
  if (src.speakerAt) {
    for (const s of sentences) {
      s.speaker = src.speakerAt(s.chunks[0]!.start, s.chunks[s.chunks.length - 1]!.end) ?? s.speaker;
    }
  }

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
      delay: 0,
      clipped: 0,
      pitchShift: 0,
      gainDb: 0,
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

  run.stage = "voices";
  run.progress = null;
  const original = await decodeToF32(source, path.join(dir, "a44.f32"), MIX_RATE);
  const voiceBySpeaker = new Map<string, string>();
  for (const speaker of new Set(run.lines.map((l) => l.speaker))) {
    const pitch = median(run.lines.filter((l) => l.speaker === speaker && l.prosody.pitchHz > 0).map((l) => l.prosody.pitchHz));
    const choice = await src.voiceFor(speaker, pitch);
    voiceBySpeaker.set(speaker, choice.voiceId);
    if (choice.notice) run.notice = choice.notice;
  }

  run.stage = "voicing";
  const ttsDir = path.join(dir, "tts");
  await mkdir(ttsDir, { recursive: true });
  const placed: PlacedPiece[][] = new Array(run.lines.length);
  let done = 0;
  run.progress = { done, total: run.lines.length };
  const paceByVoice = new Map<string, Pace>();
  const baselines = new Map<string, SpeakerBaseline>();
  for (const speaker of new Set(run.lines.map((l) => l.speaker))) {
    const own = run.lines.filter((l) => l.speaker === speaker);
    baselines.set(speaker, {
      pitchHz: median(own.map((l) => l.prosody.pitchHz).filter((p) => p > 0)),
      loudnessDb: median(own.map((l) => l.prosody.loudnessDb)),
    });
  }
  await mapLimit(run.lines, 3, async (line, i) => {
    const nextSpeechStart = run.lines[i + 1]?.start ?? Math.max(duration, line.end + 1);
    const voiceId = voiceBySpeaker.get(line.speaker)!;
    if (!paceByVoice.has(voiceId)) paceByVoice.set(voiceId, { chars: 0, seconds: 0 });
    placed[i] = await voiceSentence(
      run,
      i,
      voiceId,
      ttsDir,
      inputs[i]!,
      ctx,
      nextSpeechStart,
      original,
      paceByVoice.get(voiceId)!,
      analysis,
      baselines.get(line.speaker)!,
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
  const output = path.join(dir, `dubbed-${run.target}.m4a`);
  await ffmpeg([
    "-f", "f32le", "-ar", String(MIX_RATE), "-ac", "1", "-i", mixPath,
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output,
  ]);
  run.outputPath = output;
}
