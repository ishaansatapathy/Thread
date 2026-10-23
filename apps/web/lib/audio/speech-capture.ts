/**
 * Browser-side audio for Gnani: capture → voice-activity gating → 16 kHz mono WAV.
 *
 * Silence never leaves the browser. Speech is cut at natural pauses (so words aren't
 * split across clips, which hurts accuracy) and short noises (coughs, clicks) are
 * dropped. That's what keeps Gnani usage proportional to how much people actually talk.
 */

export const TARGET_SAMPLE_RATE = 16_000;
const FRAME_SECONDS = 0.02;
const WORKLET_URL = "/audio/pcm-capture-worklet.js";

export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (const v of frame) sum += v * v;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

function concat(frames: Float32Array[]): Float32Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}

export type SpeechChunk = { wav: Blob; startSec: number; durationSec: number };

export type ChunkerStats = {
  /** Seconds of audio heard. */
  heardSec: number;
  /** Seconds of speech actually sent to Gnani. */
  sentSec: number;
  chunks: number;
};

type ChunkerOptions = {
  sampleRate: number;
  onChunk: (chunk: SpeechChunk) => void;
  onLevel?: (level: number, speaking: boolean) => void;
  /** Added to every chunk's start time — continues a meeting timeline after a pause. */
  baseOffsetSec?: number;
  minSpeechSec?: number;
  silenceToCutSec?: number;
  maxChunkSec?: number;
};

/** Splits a live PCM stream into speech-only clips, cut at pauses. */
export class VoiceActivityChunker {
  private readonly frameSize: number;
  private readonly preRollFrames = Math.round(0.3 / FRAME_SECONDS);
  private readonly trailSilenceFrames = Math.round(0.25 / FRAME_SECONDS);
  private pending = new Float32Array(0);
  private preRoll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private speaking = false;
  private voicedFrames = 0;
  private silenceFrames = 0;
  private chunkStartFrame = 0;
  private frameCount = 0;
  private noiseFloor = 0.004;
  readonly stats: ChunkerStats = { heardSec: 0, sentSec: 0, chunks: 0 };

  constructor(private readonly opts: ChunkerOptions) {
    this.frameSize = Math.round(opts.sampleRate * FRAME_SECONDS);
  }

  push(samples: Float32Array) {
    let data = samples;
    if (this.pending.length) {
      data = concat([this.pending, samples]);
      this.pending = new Float32Array(0);
    }
    let offset = 0;
    while (offset + this.frameSize <= data.length) {
      this.handleFrame(data.slice(offset, offset + this.frameSize));
      offset += this.frameSize;
    }
    if (offset < data.length) this.pending = data.slice(offset);
  }

  /** Flushes whatever speech is buffered (call on stop). */
  finish() {
    if (this.speaking) this.flush(false);
  }

  private handleFrame(frame: Float32Array) {
    const level = rms(frame);
    const threshold = Math.max(0.012, this.noiseFloor * 3.5);
    const voiced = level > threshold;
    if (!voiced) this.noiseFloor = Math.min(0.05, this.noiseFloor * 0.995 + level * 0.005);
    this.opts.onLevel?.(level, this.speaking);

    if (!this.speaking) {
      this.preRoll.push(frame);
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      if (voiced) {
        this.speaking = true;
        this.frames = [...this.preRoll];
        this.chunkStartFrame = this.frameCount - this.preRoll.length + 1;
        this.voicedFrames = 1;
        this.silenceFrames = 0;
      }
    } else {
      this.frames.push(frame);
      if (voiced) {
        this.voicedFrames++;
        this.silenceFrames = 0;
      } else {
        this.silenceFrames++;
      }
      const lengthSec = this.frames.length * FRAME_SECONDS;
      if (this.silenceFrames * FRAME_SECONDS >= (this.opts.silenceToCutSec ?? 0.7)) this.flush(false);
      else if (lengthSec >= (this.opts.maxChunkSec ?? 24)) this.flush(true);
    }
    this.frameCount++;
    this.stats.heardSec = this.frameCount * FRAME_SECONDS;
  }

  private flush(continuing: boolean) {
    const keep = this.frames.length - Math.max(0, this.silenceFrames - this.trailSilenceFrames);
    const frames = this.frames.slice(0, Math.max(0, keep));
    const voicedSec = this.voicedFrames * FRAME_SECONDS;

    if (frames.length && voicedSec >= (this.opts.minSpeechSec ?? 0.6)) {
      const samples = downsample(concat(frames), this.opts.sampleRate);
      const durationSec = frames.length * FRAME_SECONDS;
      this.stats.sentSec += durationSec;
      this.stats.chunks++;
      this.opts.onChunk({
        wav: encodeWav(samples),
        startSec: (this.opts.baseOffsetSec ?? 0) + Math.max(0, this.chunkStartFrame) * FRAME_SECONDS,
        durationSec,
      });
    }

    this.frames = [];
    this.voicedFrames = 0;
    this.silenceFrames = 0;
    this.preRoll = [];
    this.speaking = continuing;
    if (continuing) this.chunkStartFrame = this.frameCount + 1;
  }
}

export type PcmTap = { context: AudioContext; stop: () => void };

/** Taps a MediaStream into PCM frames via an AudioWorklet (silent output, no echo). */
export async function tapStream(
  stream: MediaStream,
  onFrames: (frames: Float32Array) => void,
  context?: AudioContext,
): Promise<PcmTap> {
  const ctx = context ?? new AudioContext();
  await ctx.audioWorklet.addModule(WORKLET_URL);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture");
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);
  node.port.onmessage = (event: MessageEvent<Float32Array>) => onFrames(event.data);
  if (ctx.state === "suspended") await ctx.resume();
  return {
    context: ctx,
    stop: () => {
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
        sink.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}

/** Trims leading/trailing silence from a 16 kHz clip. */
function trimSilence(samples: Float32Array): Float32Array {
  const frame = Math.round(TARGET_SAMPLE_RATE * FRAME_SECONDS);
  const levels: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) levels.push(rms(samples.subarray(i, i + frame)));
  const floor = Math.min(...levels.slice(0, 10), 0.01);
  const threshold = Math.max(0.012, floor * 3);
  const first = levels.findIndex((l) => l > threshold);
  if (first === -1) return new Float32Array(0);
  let last = levels.length - 1;
  while (last > first && levels[last]! <= threshold) last--;
  const pad = Math.round(0.2 / FRAME_SECONDS);
  return samples.slice(Math.max(0, first - pad) * frame, Math.min(levels.length, last + pad + 1) * frame);
}

/** Push-to-talk: records the mic until stopped (or maxSec), returns a trimmed WAV or null for silence. */
export class UtteranceRecorder {
  private frames: Float32Array[] = [];
  private tap: PcmTap | null = null;
  private stream: MediaStream | null = null;
  private sampleRate = 48_000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly opts: { maxSec?: number; onLevel?: (level: number) => void; onAutoStop?: () => void } = {},
  ) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.frames = [];
    this.tap = await tapStream(this.stream, (frames) => {
      this.frames.push(frames);
      this.opts.onLevel?.(rms(frames));
    });
    this.sampleRate = this.tap.context.sampleRate;
    this.timer = setTimeout(() => this.opts.onAutoStop?.(), (this.opts.maxSec ?? 28) * 1000);
  }

  async stop(): Promise<{ wav: Blob; durationSec: number } | null> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const context = this.tap?.context;
    this.tap?.stop();
    this.tap = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await context?.close().catch(() => undefined);

    const samples = trimSilence(downsample(concat(this.frames), this.sampleRate));
    this.frames = [];
    if (samples.length < TARGET_SAMPLE_RATE * 0.4) return null;
    return { wav: encodeWav(samples), durationSec: samples.length / TARGET_SAMPLE_RATE };
  }

  cancel() {
    void this.stop();
  }
}

/** Decodes an audio/video file and splits it into speech clips, offline. */
export async function chunkRecordingFile(
  file: File,
  onChunk: (chunk: SpeechChunk) => void,
): Promise<ChunkerStats> {
  const decodeContext = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(await file.arrayBuffer());
  } finally {
    await decodeContext.close().catch(() => undefined);
  }

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const mono = rendered.getChannelData(0);

  const chunker = new VoiceActivityChunker({ sampleRate: TARGET_SAMPLE_RATE, onChunk });
  const step = TARGET_SAMPLE_RATE; // feed one second at a time
  for (let i = 0; i < mono.length; i += step) chunker.push(mono.slice(i, i + step));
  chunker.finish();
  return chunker.stats;
}
