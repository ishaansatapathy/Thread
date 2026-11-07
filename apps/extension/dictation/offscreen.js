// Records the microphone for voice dictation. Chrome only lets an extension page (not a service
// worker or a content script) hold the mic quietly, so the background opens this hidden page while
// the user dictates and closes it afterwards. Only speech is kept: silence is dropped in the
// browser, and each spoken phrase is handed to the background as a short WAV clip.
import { VoiceActivityChunker, tapStream } from "../lib/audio.js";

let ctx = null;
let stream = null;
let tap = null;
let chunker = null;
let seq = 0;
let lastLevelAt = 0;
const sending = new Set();

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function post(message) {
  return chrome.runtime.sendMessage({ target: "background", ...message }).catch(() => {});
}

async function start() {
  if (stream) return { ok: true };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    stream = null;
    const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    return { ok: false, error: denied ? "permission" : "mic" };
  }
  ctx = new AudioContext();
  seq = 0;
  chunker = new VoiceActivityChunker({
    sampleRate: ctx.sampleRate,
    minSpeechSec: 0.35,
    silenceToCutSec: 0.65,
    maxChunkSec: 20,
    onChunk: (chunk) => {
      const job = (async () => {
        const wav = toBase64(await chunk.wav.arrayBuffer());
        await post({ type: "dictation:chunk", wav, seq: seq++ });
      })();
      sending.add(job);
      job.finally(() => sending.delete(job));
    },
    onLevel: (level) => {
      const now = performance.now();
      if (now - lastLevelAt < 120) return;
      lastLevelAt = now;
      post({ type: "dictation:level", level });
    },
  });
  tap = await tapStream(stream, (frames) => chunker.push(frames), ctx);
  return { ok: true };
}

async function stop() {
  chunker?.finish();
  // Let the last phrase reach the background before this page goes away.
  await Promise.allSettled([...sending]);
  tap?.stop();
  stream?.getTracks().forEach((track) => track.stop());
  await ctx?.close().catch(() => {});
  ctx = stream = tap = chunker = null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  if (message.type === "dictation:start") {
    start().then(sendResponse);
    return true;
  }
  if (message.type === "dictation:stop") {
    stop().then(() => sendResponse({ ok: true }));
    return true;
  }
});
