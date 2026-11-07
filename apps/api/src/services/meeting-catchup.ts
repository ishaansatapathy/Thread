/**
 * "Catch me up": the last few minutes of a meeting, summarised in the listener's language and read
 * aloud by a Gnani voice. If the summary can't be written (e.g. the language model is unavailable),
 * the latest captions are read as they were said, so the button still helps.
 */
import { formatSegments } from "@repo/services/ai/summarize-meeting";
import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";

import { catchUpSummary, type DubTargetCode } from "./dub-translate";
import { gnaniVoiceForPitch, isGnaniConfigured, normalizeGnaniLanguage, speakText } from "./gnani";
import { getMeeting } from "./meetings";

const MAX_TRANSCRIPT_CHARS = 6000;
const FALLBACK_CHARS = 450;

export type CatchUp = { text: string; summarized: boolean; minutes: number; audio: Buffer; mimeType: string };

export async function catchUpOnMeeting(userId: string, meetingId: string, input: { minutes: number; target: DubTargetCode }): Promise<CatchUp> {
  if (!isGnaniConfigured()) throw new ServiceError("PRECONDITION_FAILED", "Catch me up needs GNANI_API_KEY on the server.");
  const row = await getMeeting(userId, meetingId);
  const all = (Array.isArray(row.segmentsJson) ? row.segmentsJson : []).filter((s) => s.text?.trim());
  if (all.length === 0) throw new ServiceError("BAD_REQUEST", "Nothing has been said in this meeting yet.");

  const minutes = Math.min(30, Math.max(1, Math.round(input.minutes)));
  const sorted = [...all].sort((a, b) => a.startTime - b.startTime);
  const latest = sorted.reduce((max, s) => Math.max(max, s.endTime ?? 0), 0);
  const recent = sorted.filter((s) => (s.endTime ?? 0) >= latest - minutes * 60);
  let transcript = formatSegments(recent);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);

  let text = "";
  try {
    text = await catchUpSummary(transcript, input.target, minutes);
  } catch (error) {
    logger.warn("meeting.catchup_summary_failed", { message: error instanceof Error ? error.message : String(error) });
  }

  const summarized = Boolean(text);
  let language: string = input.target;
  if (!summarized) {
    // Read the newest lines as spoken, in the language they were transcribed in.
    const spoken = recent.map((s) => s.text.trim()).join(" ");
    text = spoken.length > FALLBACK_CHARS ? spoken.slice(-FALLBACK_CHARS).replace(/^\S*\s/, "") : spoken;
    language = normalizeGnaniLanguage(row.languageCode);
  }

  const speech = await speakText({ text, language, voice: gnaniVoiceForPitch(220) });
  return { text, summarized, minutes, audio: speech.audio, mimeType: speech.mimeType };
}
