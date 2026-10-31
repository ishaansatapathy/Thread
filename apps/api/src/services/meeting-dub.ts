/**
 * Dubbing inside meetings. Everything here is opt-in and audio-only:
 *  - after the meeting: dub the saved recording (only exists if the user ticked "Save audio for dubbing")
 *  - live, speak:  the user's own words → translated → spoken in their "My voice" into the call
 *  - live, listen: other people's words → translated → played to the user in a stock voice
 * Only the signed-in user's consented voice is ever cloned.
 */
import { ServiceError } from "@repo/services/errors";

import { ANALYSIS_RATE, TONE_VOICE_SETTINGS, analyzeLine, resampleBy, type Tone } from "./dub-media";
import { startDub, type DubRun } from "./dub-pipeline";
import { translateUtterance, type DubTargetCode } from "./dub-translate";
import { synthesizeLive } from "./elevenlabs";
import { transcribeClip } from "./gnani";
import { assembleMeetingAudio, meetingWorkDir, readPcm16, type SpeechSpan } from "./meeting-audio";
import { getMeeting } from "./meetings";
import { getVoiceProfile, stockVoice } from "./voice-profile";

// ── After the meeting ────────────────────────────────────────────────────────

const runs = new Map<string, { userId: string; run: DubRun }>();

export type PublicDubRun = Omit<DubRun, "outputPath"> & { hasAudio: boolean };

export function toPublicRun(run: DubRun): PublicDubRun {
  const { outputPath, ...rest } = run;
  return { ...rest, hasAudio: Boolean(outputPath) };
}

/** The speaker whose saved clips cover most of [start, end]. */
function speakerOverlapping(spans: SpeechSpan[], start: number, end: number): string | null {
  const totals = new Map<string, number>();
  for (const s of spans) {
    const overlap = Math.min(end, s.end) - Math.max(start, s.start);
    if (overlap > 0) totals.set(s.speaker, (totals.get(s.speaker) ?? 0) + overlap);
  }
  let best: string | null = null;
  let bestTime = 0;
  for (const [speaker, time] of totals) {
    if (time > bestTime) {
      best = speaker;
      bestTime = time;
    }
  }
  return best;
}

export async function startMeetingDub(userId: string, meetingId: string, target: DubTargetCode): Promise<DubRun> {
  const meeting = await getMeeting(userId, meetingId);
  if (meeting.status !== "ready") throw new ServiceError("CONFLICT", "End the meeting first, then dub it.");
  if (runs.get(meetingId)?.run.status === "running") throw new ServiceError("CONFLICT", "This meeting is already being dubbed.");

  const audio = await assembleMeetingAudio(meetingId);
  if (!audio) {
    throw new ServiceError(
      "PRECONDITION_FAILED",
      "No audio was saved for this meeting. Tick \"Save audio for dubbing\" before you start capturing next time.",
    );
  }

  const profile = await getVoiceProfile(userId);
  const run = startDub(
    {
      id: meetingId,
      dir: meetingWorkDir(meetingId),
      sourcePath: audio.wavPath,
      durationSeconds: audio.seconds,
      speakerAt: (start, end) => speakerOverlapping(audio.spans, start, end),
      voiceFor: async (speaker, pitchHz) => {
        if (speaker === "you" && profile) return { voiceId: profile };
        if (speaker === "you") {
          return { voiceId: stockVoice(pitchHz), notice: "Set up My voice to hear your own lines in your own voice." };
        }
        return { voiceId: stockVoice(pitchHz) };
      },
    },
    target,
    meeting.languageCode ?? "auto",
  );
  runs.set(meetingId, { userId, run });
  return run;
}

export function getMeetingDub(userId: string, meetingId: string): DubRun | null {
  const entry = runs.get(meetingId);
  return entry && entry.userId === userId ? entry.run : null;
}

// ── Live, during the call ────────────────────────────────────────────────────

export type LiveDirection = "speak" | "listen";

type LiveState = { recent: string[]; loudness: number[]; pitch: number[]; touched: number };
const live = new Map<string, LiveState>();
const MAX_LIVE_STATES = 500;
const HISTORY = 40;

function liveState(key: string): LiveState {
  let state = live.get(key);
  if (!state) {
    if (live.size >= MAX_LIVE_STATES) {
      const oldest = [...live.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest) live.delete(oldest[0]);
    }
    state = { recent: [], loudness: [], pitch: [], touched: 0 };
    live.set(key, state);
  }
  state.touched = Date.now();
  return state;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** How this utterance compares with how the same person has been talking so far in the call. */
function liveTone(loudnessDelta: number, pitchDeltaSt: number): Tone {
  if (loudnessDelta > 4 || (loudnessDelta > 2 && pitchDeltaSt > 2)) return "excited";
  if (loudnessDelta < -5) return "calm";
  return "neutral";
}

export type LiveDubResult = { audio: Buffer; text: string; translation: string; gainDb: number; tone: Tone };

export async function dubLiveUtterance(
  userId: string,
  meetingId: string,
  input: { wav: Buffer; direction: LiveDirection; sourceLanguage: string; target: DubTargetCode },
): Promise<LiveDubResult | null> {
  await getMeeting(userId, meetingId);

  const profile = input.direction === "speak" ? await getVoiceProfile(userId) : null;
  if (input.direction === "speak" && !profile) {
    throw new ServiceError("PRECONDITION_FAILED", "Set up My voice in Thread first, so the call hears you in your own voice.");
  }

  const pcm = readPcm16(input.wav);
  if (!pcm) throw new ServiceError("BAD_REQUEST", "Send 16 kHz mono WAV audio.");

  const text = await transcribeClip({ data: input.wav, filename: "utterance.wav", mimeType: "audio/wav" }, input.sourceLanguage);
  if (!text) return null;

  const state = liveState(`${userId}:${meetingId}:${input.direction}`);
  const prosody = analyzeLine(resampleBy(pcm, 16000 / ANALYSIS_RATE), 0, pcm.length / 16000, text);
  state.loudness = [...state.loudness, prosody.loudnessDb].slice(-HISTORY);
  if (prosody.pitchHz > 0) state.pitch = [...state.pitch, prosody.pitchHz].slice(-HISTORY);
  const baseLoudness = median(state.loudness);
  const basePitch = median(state.pitch);
  const loudnessDelta = prosody.loudnessDb - baseLoudness;
  const pitchDelta = prosody.pitchHz > 0 && basePitch > 0 ? 12 * Math.log2(prosody.pitchHz / basePitch) : 0;
  const tone = liveTone(loudnessDelta, pitchDelta);

  const translation = await translateUtterance(text, input.target, state.recent);
  if (!translation) return null;

  const settings = TONE_VOICE_SETTINGS[tone];
  const audio = await synthesizeLive({
    voiceId: profile ?? stockVoice(prosody.pitchHz || basePitch),
    text: translation,
    previousText: state.recent.at(-1),
    stability: settings.stability,
    style: settings.style,
  });
  state.recent = [...state.recent, translation].slice(-5);

  return { audio, text, translation, gainDb: Math.round(Math.max(-6, Math.min(6, loudnessDelta)) * 10) / 10, tone };
}
