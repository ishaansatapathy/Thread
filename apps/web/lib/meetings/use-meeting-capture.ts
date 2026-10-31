"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  chunkRecordingFile,
  tapStream,
  VoiceActivityChunker,
  type PcmTap,
  type SpeechChunk,
} from "~/lib/audio/speech-capture";

export type LiveSegment = { speakerId: string; startTime: number; endTime: number; text: string };
export type CaptureSpeaker = "you" | "meeting" | "room";
export type CaptureState = "idle" | "starting" | "live" | "stopping";

export type CaptureStats = {
  heardSec: number;
  sentSec: number;
  chunks: number;
  inFlight: number;
  failed: number;
};

const MAX_CONCURRENT_UPLOADS = 3;
const EMPTY_STATS: CaptureStats = { heardSec: 0, sentSec: 0, chunks: 0, inFlight: 0, failed: 0 };

export class CaptureError extends Error {
  constructor(
    readonly code: "not_configured" | "meeting_closed" | "no_tab_audio" | "permission" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

type Job = { chunk: SpeechChunk; speaker: CaptureSpeaker };

async function postChunk(meetingId: string, job: Job, language: string, keepAudio: boolean): Promise<LiveSegment | null> {
  const res = await fetch(`/api-meetings/${meetingId}/chunk`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "audio/wav",
      "x-thread-csrf": "1",
      "X-Start-Seconds": job.chunk.startSec.toFixed(2),
      "X-Duration-Seconds": job.chunk.durationSec.toFixed(2),
      "X-Speaker": job.speaker,
      "X-Language": language,
      ...(keepAudio ? { "X-Keep-Audio": "1" } : {}),
    },
    body: job.chunk.wav,
  });
  const data = (await res.json().catch(() => ({}))) as { segment?: LiveSegment | null; error?: string };
  if (res.status === 412) throw new CaptureError("not_configured", data.error ?? "Gnani isn't configured on the server.");
  if (res.status === 409) throw new CaptureError("meeting_closed", data.error ?? "This meeting has ended.");
  if (!res.ok) throw new CaptureError("unknown", data.error ?? "Transcription failed");
  return data.segment ?? null;
}

/**
 * Live meeting capture. The mic ("you") and the Meet tab's audio ("meeting") are separate
 * streams, so every line is attributed without paying for diarization. Each stream is
 * voice-gated in the browser; only speech clips are uploaded, three at a time.
 */
export function useMeetingCapture(opts: {
  meetingId: string;
  language: string;
  /** The user opted in to saving this meeting's audio so it can be dubbed afterwards. */
  keepAudio: boolean;
  onSegment: (segment: LiveSegment) => void;
  onFatal: (error: CaptureError) => void;
}) {
  const [state, setState] = useState<CaptureState>("idle");
  const [sources, setSources] = useState<{ mic: boolean; tab: boolean }>({ mic: false, tab: false });
  const [levels, setLevels] = useState<{ mic: number; tab: number }>({ mic: 0, tab: 0 });
  const [stats, setStats] = useState<CaptureStats>(EMPTY_STATS);
  const [uploadProgress, setUploadProgress] = useState<{ total: number; done: number } | null>(null);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const queueRef = useRef<Job[]>([]);
  const inFlightRef = useRef(0);
  const failedRef = useRef(0);
  const drainWaitersRef = useRef<Array<() => void>>([]);
  const chunkersRef = useRef<VoiceActivityChunker[]>([]);
  const tapsRef = useRef<PcmTap[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const contextRef = useRef<AudioContext | null>(null);
  const levelRef = useRef({ mic: 0, tab: 0 });
  const fatalRef = useRef(false);

  const publishStats = useCallback(() => {
    const totals = chunkersRef.current.reduce(
      (acc, c) => ({
        heardSec: Math.max(acc.heardSec, c.stats.heardSec),
        sentSec: acc.sentSec + c.stats.sentSec,
        chunks: acc.chunks + c.stats.chunks,
      }),
      { heardSec: 0, sentSec: 0, chunks: 0 },
    );
    setStats({ ...totals, inFlight: inFlightRef.current + queueRef.current.length, failed: failedRef.current });
  }, []);

  const pump = useCallback(() => {
    while (inFlightRef.current < MAX_CONCURRENT_UPLOADS && queueRef.current.length > 0 && !fatalRef.current) {
      const job = queueRef.current.shift()!;
      inFlightRef.current++;
      void postChunk(optsRef.current.meetingId, job, optsRef.current.language, optsRef.current.keepAudio)
        .then((segment) => {
          if (segment) optsRef.current.onSegment(segment);
        })
        .catch((error: unknown) => {
          const captureError = error instanceof CaptureError ? error : new CaptureError("unknown", String(error));
          if (captureError.code === "not_configured" || captureError.code === "meeting_closed") {
            fatalRef.current = true;
            queueRef.current = [];
            optsRef.current.onFatal(captureError);
          } else {
            failedRef.current++;
          }
        })
        .finally(() => {
          inFlightRef.current--;
          setUploadProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          if (inFlightRef.current === 0 && queueRef.current.length === 0) {
            drainWaitersRef.current.splice(0).forEach((resolve) => resolve());
          }
          pump();
          publishStats();
        });
    }
    publishStats();
  }, [publishStats]);

  const enqueue = useCallback(
    (chunk: SpeechChunk, speaker: CaptureSpeaker) => {
      queueRef.current.push({ chunk, speaker });
      pump();
    },
    [pump],
  );

  const waitForDrain = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (inFlightRef.current === 0 && queueRef.current.length === 0) resolve();
        else drainWaitersRef.current.push(resolve);
      }),
    [],
  );

  const teardown = useCallback(() => {
    chunkersRef.current.forEach((c) => c.finish());
    tapsRef.current.forEach((t) => t.stop());
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void contextRef.current?.close().catch(() => undefined);
    tapsRef.current = [];
    streamsRef.current = [];
    contextRef.current = null;
    levelRef.current = { mic: 0, tab: 0 };
    setLevels({ mic: 0, tab: 0 });
    setSources({ mic: false, tab: false });
  }, []);

  const stop = useCallback(async () => {
    if (state !== "live" && state !== "starting") return;
    setState("stopping");
    teardown();
    publishStats();
    await waitForDrain();
    setState("idle");
  }, [publishStats, state, teardown, waitForDrain]);

  /**
   * Starts capture. `tab` asks the browser to share a tab — pick the Meet tab and tick
   * "Also share tab audio". `micSpeaker` is "room" for in-person meetings (one mic, everyone).
   */
  const start = useCallback(
    async (input: { mic: boolean; tab: boolean; micSpeaker?: CaptureSpeaker; baseOffsetSec: number }) => {
      if (state !== "idle") return;
      fatalRef.current = false;
      setState("starting");
      const context = new AudioContext();
      contextRef.current = context;
      chunkersRef.current = [];

      const attach = async (stream: MediaStream, speaker: CaptureSpeaker, levelKey: "mic" | "tab") => {
        const chunker = new VoiceActivityChunker({
          sampleRate: context.sampleRate,
          baseOffsetSec: input.baseOffsetSec,
          onChunk: (chunk) => enqueue(chunk, speaker),
          onLevel: (level) => {
            levelRef.current[levelKey] = level;
          },
        });
        chunkersRef.current.push(chunker);
        tapsRef.current.push(await tapStream(stream, (frames) => chunker.push(frames), context));
        streamsRef.current.push(stream);
      };

      try {
        const active = { mic: false, tab: false };
        if (input.tab) {
          const display = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "browser" },
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            preferCurrentTab: false,
            selfBrowserSurface: "exclude",
            surfaceSwitching: "include",
            systemAudio: "include",
          } as DisplayMediaStreamOptions);
          const audio = display.getAudioTracks();
          if (audio.length === 0) {
            display.getTracks().forEach((t) => t.stop());
            throw new CaptureError(
              "no_tab_audio",
              "No audio came with that share. Pick the Meet tab and tick \"Also share tab audio\".",
            );
          }
          display.getVideoTracks().forEach((t) => {
            t.enabled = false;
          });
          streamsRef.current.push(display);
          audio[0]!.addEventListener("ended", () => setSources((s) => ({ ...s, tab: false })));
          await attach(new MediaStream(audio), "meeting", "tab");
          active.tab = true;
        }
        if (input.mic) {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          await attach(mic, input.micSpeaker ?? "you", "mic");
          active.mic = true;
        }
        setSources(active);
        setState("live");
      } catch (error) {
        teardown();
        setState("idle");
        if (error instanceof CaptureError) throw error;
        if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
          throw new CaptureError("permission", "Permission was denied — allow the microphone / tab share and try again.");
        }
        throw new CaptureError("unknown", error instanceof Error ? error.message : "Couldn't start capture.");
      }
    },
    [enqueue, state, teardown],
  );

  /** Transcribes a recording file through the same voice-gated path, then resolves. */
  const processFile = useCallback(
    async (file: File, baseOffsetSec = 0) => {
      fatalRef.current = false;
      failedRef.current = 0;
      const jobs: SpeechChunk[] = [];
      await chunkRecordingFile(file, (chunk) =>
        jobs.push({ ...chunk, startSec: chunk.startSec + baseOffsetSec }),
      );
      setUploadProgress({ total: jobs.length, done: 0 });
      jobs.forEach((chunk) => enqueue(chunk, "room"));
      await waitForDrain();
      const failed = failedRef.current;
      return { chunks: jobs.length, failed, aborted: fatalRef.current };
    },
    [enqueue, waitForDrain],
  );

  useEffect(() => {
    if (state !== "live") return;
    const id = window.setInterval(() => {
      setLevels({ ...levelRef.current });
      publishStats();
    }, 120);
    return () => window.clearInterval(id);
  }, [publishStats, state]);

  useEffect(() => {
    if (state !== "live") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state]);

  useEffect(() => () => teardown(), [teardown]);

  return { state, sources, levels, stats, uploadProgress, start, stop, processFile, clearUploadProgress: () => setUploadProgress(null) };
}
