// Voice-activity-gated capture → 16 kHz mono WAV clips for Gnani.
// Same algorithm as apps/web/lib/audio/speech-capture.ts: silence and short noises never
// leave the browser, and speech is cut at natural pauses so words aren't split.

export const TARGET_SAMPLE_RATE = 16000;
const FRAME_SECONDS = 0.02;

export function downsample(input, fromRate, toRate = TARGET_SAMPLE_RATE) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function encodeWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function rms(frame) {
  let sum = 0;
  for (const v of frame) sum += v * v;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

function concat(frames) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}

export class VoiceActivityChunker {
  constructor({ sampleRate, onChunk, onLevel, baseOffsetSec = 0, minSpeechSec = 0.6, silenceToCutSec = 0.7, maxChunkSec = 24 }) {
    this.opts = { sampleRate, onChunk, onLevel, baseOffsetSec, minSpeechSec, silenceToCutSec, maxChunkSec };
    this.frameSize = Math.round(sampleRate * FRAME_SECONDS);
    this.preRollFrames = Math.round(0.3 / FRAME_SECONDS);
    this.trailSilenceFrames = Math.round(0.25 / FRAME_SECONDS);
    this.pending = new Float32Array(0);
    this.preRoll = [];
    this.frames = [];
    this.speaking = false;
    this.voicedFrames = 0;
    this.silenceFrames = 0;
    this.chunkStartFrame = 0;
    this.frameCount = 0;
    this.noiseFloor = 0.004;
    this.stats = { heardSec: 0, sentSec: 0, chunks: 0 };
  }

  push(samples) {
    let data = samples;
    if (this.pending.length) {
      data = concat([this.pending, samples]);
      this.pending = new Float32Array(0);
    }
    let offset = 0;
    while (offset + this.frameSize <= data.length) {
      this.#frame(data.slice(offset, offset + this.frameSize));
      offset += this.frameSize;
    }
    if (offset < data.length) this.pending = data.slice(offset);
  }

  finish() {
    if (this.speaking) this.#flush(false);
  }

  #frame(frame) {
    const level = rms(frame);
    const threshold = Math.max(0.012, this.noiseFloor * 3.5);
    const voiced = level > threshold;
    if (!voiced) this.noiseFloor = Math.min(0.05, this.noiseFloor * 0.995 + level * 0.005);
    this.opts.onLevel?.(level);

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
      if (this.silenceFrames * FRAME_SECONDS >= this.opts.silenceToCutSec) this.#flush(false);
      else if (lengthSec >= this.opts.maxChunkSec) this.#flush(true);
    }
    this.frameCount++;
    this.stats.heardSec = this.frameCount * FRAME_SECONDS;
  }

  #flush(continuing) {
    const keep = this.frames.length - Math.max(0, this.silenceFrames - this.trailSilenceFrames);
    const frames = this.frames.slice(0, Math.max(0, keep));
    if (frames.length && this.voicedFrames * FRAME_SECONDS >= this.opts.minSpeechSec) {
      const durationSec = frames.length * FRAME_SECONDS;
      this.stats.sentSec += durationSec;
      this.stats.chunks++;
      this.opts.onChunk({
        wav: encodeWav(downsample(concat(frames), this.opts.sampleRate)),
        startSec: this.opts.baseOffsetSec + Math.max(0, this.chunkStartFrame) * FRAME_SECONDS,
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

/** Taps a MediaStream into PCM frames through an AudioWorklet with a silent output. */
export async function tapStream(stream, onFrames, context) {
  const ctx = context ?? new AudioContext();
  await ctx.audioWorklet.addModule(chrome.runtime.getURL("lib/pcm-capture-worklet.js"));
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture");
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);
  node.port.onmessage = (event) => onFrames(event.data);
  if (ctx.state === "suspended") await ctx.resume();
  return {
    context: ctx,
    stop() {
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
export function trimSilence(samples) {
  const frame = Math.round(TARGET_SAMPLE_RATE * FRAME_SECONDS);
  const levels = [];
  for (let i = 0; i + frame <= samples.length; i += frame) levels.push(rms(samples.subarray(i, i + frame)));
  if (!levels.length) return new Float32Array(0);
  const floor = Math.min(...levels.slice(0, 10), 0.01);
  const threshold = Math.max(0.012, floor * 3);
  const first = levels.findIndex((l) => l > threshold);
  if (first === -1) return new Float32Array(0);
  let last = levels.length - 1;
  while (last > first && levels[last] <= threshold) last--;
  const pad = Math.round(0.2 / FRAME_SECONDS);
  return samples.slice(Math.max(0, first - pad) * frame, Math.min(levels.length, last + pad + 1) * frame);
}

export { concat };
