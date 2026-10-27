/**
 * Frame-level alignment of a dubbed phrase onto the original speaker's timing.
 *
 * Both signals are reduced to 10 ms loudness envelopes (loud ≈ mouth open, quiet ≈ closed or
 * between syllables). Dynamic time warping finds the best monotonic mapping between them; anchors
 * taken at the dub's syllable valleys become a piecewise-linear time map, and WSOLA (waveform-
 * similarity overlap-add) stretches the dub along that map without changing its pitch.
 */

export const FRAME_SECONDS = 0.01;

export function envelope(pcm: Float32Array, rate: number): Float32Array {
  const hop = Math.round(rate * FRAME_SECONDS);
  const frames = Math.max(1, Math.floor(pcm.length / hop));
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < Math.min(pcm.length, (f + 1) * hop); i++) sum += pcm[i]! * pcm[i]!;
    db[f] = 10 * Math.log10(sum / hop + 1e-10);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const lo = sorted[Math.floor(frames * 0.1)]!;
  const hi = sorted[Math.floor(frames * 0.95)]!;
  const span = Math.max(6, hi - lo);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = db[Math.max(0, f - 1)]!;
    const b = db[f]!;
    const c = db[Math.min(frames - 1, f + 1)]!;
    out[f] = Math.min(1, Math.max(0, ((a + b + c) / 3 - lo) / span));
  }
  return out;
}

/** Pearson correlation of two envelopes resampled to the same length (1 = identical rhythm). */
export function envelopeCorrelation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const pick = (x: Float32Array, i: number) => x[Math.min(x.length - 1, Math.floor((i * x.length) / n))]!;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += pick(a, i);
    mb += pick(b, i);
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < n; i++) {
    const x = pick(a, i) - ma;
    const y = pick(b, i) - mb;
    num += x * y;
    da += x * x;
    dbb += y * y;
  }
  return num / Math.sqrt(da * dbb + 1e-12);
}

// Tuned on a held-out clip: matching onsets (mouth opening) as well as loudness gave the best rhythm match.
const ONSET_WEIGHT = 1;
const STEP_PENALTY = 0.15;
const ANCHOR_STEP_FRAMES = 8;
const MIN_LOCAL_RATE = 0.5;
const MAX_LOCAL_RATE = 2.0;

function onsets(env: Float32Array): Float32Array {
  const out = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) out[i] = Math.max(0, env[i]! - env[i - 1]!) * 4;
  return out;
}

/** DTW over loudness + onset envelopes with a Sakoe-Chiba band; for each dub frame, the matched original frame. */
function dtwMap(dub: Float32Array, orig: Float32Array): Float32Array {
  const n = dub.length;
  const m = orig.length;
  const dubOn = onsets(dub);
  const origOn = onsets(orig);
  const band = Math.max(Math.abs(n - m), Math.round(0.25 * Math.max(n, m))) + 2;
  const INF = 1e9;
  const cost = new Float32Array((n + 1) * (m + 1)).fill(INF);
  const idx = (i: number, j: number) => i * (m + 1) + j;
  cost[idx(0, 0)] = 0;
  for (let i = 1; i <= n; i++) {
    const center = (i * m) / n;
    const jFrom = Math.max(1, Math.floor(center - band));
    const jTo = Math.min(m, Math.ceil(center + band));
    for (let j = jFrom; j <= jTo; j++) {
      const d = Math.abs(dub[i - 1]! - orig[j - 1]!) + ONSET_WEIGHT * Math.abs(dubOn[i - 1]! - origOn[j - 1]!);
      const diag = cost[idx(i - 1, j - 1)]!;
      const up = cost[idx(i - 1, j)]! + STEP_PENALTY;
      const left = cost[idx(i, j - 1)]! + STEP_PENALTY;
      cost[idx(i, j)] = d + Math.min(diag, up, left);
    }
  }
  const map = new Float32Array(n);
  const counts = new Float32Array(n);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    map[i - 1]! += j - 1;
    counts[i - 1]! += 1;
    const diag = cost[idx(i - 1, j - 1)]!;
    const up = cost[idx(i - 1, j)]!;
    const left = cost[idx(i, j - 1)]!;
    if (diag <= up && diag <= left) {
      i--;
      j--;
    } else if (up <= left) i--;
    else j--;
  }
  for (let k = 0; k < n; k++) map[k] = counts[k]! > 0 ? map[k]! / counts[k]! : (k * m) / n;
  return map;
}

export type Anchor = { out: number; in: number };

/**
 * Time map (seconds) from the original's timeline to the dub's, sampled from the DTW path every
 * 80 ms. Local speed changes stay within [MIN_LOCAL_RATE, MAX_LOCAL_RATE] so speech stays natural.
 */
export function alignmentAnchors(dubEnv: Float32Array, origEnv: Float32Array): Anchor[] {
  const n = dubEnv.length;
  const m = origEnv.length;
  const map = dtwMap(dubEnv, origEnv);
  const minRate = MIN_LOCAL_RATE;
  const maxRate = MAX_LOCAL_RATE;
  const anchors: Anchor[] = [{ out: 0, in: 0 }];
  for (let i = ANCHOR_STEP_FRAMES; i < n - ANCHOR_STEP_FRAMES; i += ANCHOR_STEP_FRAMES) {
    const prev = anchors[anchors.length - 1]!;
    const outFrame = map[i]!;
    const dOut = outFrame - prev.out / FRAME_SECONDS;
    if (dOut <= 0) continue;
    const rate = (i - prev.in / FRAME_SECONDS) / dOut;
    if (rate < minRate || rate > maxRate) continue;
    anchors.push({ out: outFrame * FRAME_SECONDS, in: i * FRAME_SECONDS });
  }
  const end = { out: m * FRAME_SECONDS, in: n * FRAME_SECONDS };
  while (anchors.length > 1) {
    const prev = anchors[anchors.length - 1]!;
    const rate = (end.in - prev.in) / Math.max(1e-6, end.out - prev.out);
    if (rate >= minRate && rate <= maxRate) break;
    anchors.pop();
  }
  anchors.push(end);
  return anchors;
}

function inputTimeAt(anchors: Anchor[], out: number): number {
  for (let k = 1; k < anchors.length; k++) {
    const a = anchors[k - 1]!;
    const b = anchors[k]!;
    if (out <= b.out || k === anchors.length - 1) {
      const t = (out - a.out) / Math.max(1e-6, b.out - a.out);
      return a.in + Math.min(1, Math.max(0, t)) * (b.in - a.in);
    }
  }
  return anchors[anchors.length - 1]!.in;
}

/**
 * WSOLA time-warp: produces `outSeconds` of audio where output time t plays input time
 * inputTimeAt(t). Pitch is preserved; a uniform stretch is just two anchors.
 */
export function warp(input: Float32Array, rate: number, anchors: Anchor[], outSeconds: number): Float32Array {
  const N = 1024;
  const Hs = N / 2;
  const delta = Math.round(rate * 0.006);
  const outLen = Math.max(1, Math.round(outSeconds * rate));
  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  const y = new Float32Array(outLen + N);
  const wsum = new Float32Array(outLen + N);
  const sample = (p: number) => (p >= 0 && p < input.length ? input[p]! : 0);
  let prevPos = -1;

  for (let k = 0; k * Hs < outLen; k++) {
    const outPos = k * Hs;
    const nominal = Math.round(inputTimeAt(anchors, outPos / rate) * rate);
    let pos = nominal;
    if (prevPos >= 0) {
      const natural = prevPos + Hs;
      let best = -Infinity;
      for (let lag = -delta; lag <= delta; lag += 2) {
        const cand = nominal + lag;
        let corr = 0;
        for (let i = 0; i < N; i += 4) corr += sample(cand + i) * sample(natural + i);
        if (corr > best) {
          best = corr;
          pos = cand;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const o = outPos + i;
      if (o >= y.length) break;
      y[o]! += sample(pos + i) * window[i]!;
      wsum[o]! += window[i]!;
    }
    prevPos = pos;
  }

  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = wsum[i]! > 1e-3 ? y[i]! / wsum[i]! : 0;
  return out;
}

export function uniformAnchors(inSeconds: number, outSeconds: number): Anchor[] {
  return [
    { out: 0, in: 0 },
    { out: outSeconds, in: inSeconds },
  ];
}
