/**
 * ElevenLabs — instant voice clone + text-to-speech for dubbing.
 * Clones are temporary: created per dub run and deleted afterwards to free voice slots.
 */
import { logger } from "@repo/logger";
import { ServiceError } from "@repo/services/errors";

const BASE_URL = (process.env.ELEVENLABS_BASE_URL?.trim() || "https://api.elevenlabs.io").replace(/\/$/, "");
const TTS_MODEL = process.env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2";

export function isElevenLabsConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new ServiceError("PRECONDITION_FAILED", "Dubbing needs ELEVENLABS_API_KEY on the server.");
  return key;
}

async function failure(res: Response, label: string): Promise<never> {
  const body = await res.text().catch(() => "");
  logger.warn("elevenlabs.request_failed", { label, status: res.status, body: body.slice(0, 500) });
  const missing = body.match(/missing the permission (\w+)/)?.[1];
  if (missing) {
    throw new ServiceError("PRECONDITION_FAILED", `Your ElevenLabs API key is missing the "${missing}" permission.`);
  }
  if (res.status === 401) throw new ServiceError("PRECONDITION_FAILED", "ElevenLabs rejected the API key.");
  if (/can_not_use_instant_voice_cloning|subscription|upgrade/i.test(body)) {
    throw new ServiceError("PRECONDITION_FAILED", "Voice cloning needs a paid ElevenLabs plan (Starter or above).");
  }
  if (/voice_limit_reached/i.test(body)) {
    throw new ServiceError("PRECONDITION_FAILED", "Your ElevenLabs account has no free voice slots. Delete a voice and retry.");
  }
  if (/quota_exceeded/i.test(body)) throw new ServiceError("PRECONDITION_FAILED", "Out of ElevenLabs credits for this month.");
  if (res.status === 429) throw new ServiceError("INTERNAL", "ElevenLabs is rate limiting. Try again in a minute.");
  throw new ServiceError("INTERNAL", `ElevenLabs ${label} failed (${res.status}).`);
}

export async function cloneVoice(name: string, sample: { data: Buffer; filename: string; mimeType: string }): Promise<string> {
  const form = new FormData();
  form.append("name", name.slice(0, 100));
  form.append("files", new Blob([new Uint8Array(sample.data)], { type: sample.mimeType }), sample.filename);
  form.append("remove_background_noise", "true");
  form.append("description", "Temporary Thread dub clone");
  const res = await fetch(`${BASE_URL}/v1/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) await failure(res, "voice clone");
  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) throw new ServiceError("INTERNAL", "ElevenLabs did not return a voice id.");
  return data.voice_id;
}

export async function deleteVoice(voiceId: string): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: "DELETE",
      headers: { "xi-api-key": apiKey() },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) logger.warn("elevenlabs.voice_delete_failed", { voiceId, status: res.status });
  } catch (error) {
    logger.warn("elevenlabs.voice_delete_failed", { voiceId, message: error instanceof Error ? error.message : String(error) });
  }
}

export type ScribeWord = { text: string; start: number; end: number; speaker: string };

/** Scribe STT with word timestamps + diarization — the timing backbone for chunk-level sync. */
export async function transcribeWords(
  audio: { data: Buffer; filename: string; mimeType: string },
  languageCode: string | null,
): Promise<{ words: ScribeWord[]; languageCode: string | null }> {
  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v2");
  form.append("file", new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }), audio.filename);
  if (languageCode) form.append("language_code", languageCode);
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  const res = await fetch(`${BASE_URL}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) await failure(res, "speech-to-text");
  const data = (await res.json()) as {
    language_code?: string;
    words?: Array<{ text?: string; start?: number; end?: number; type?: string; speaker_id?: string }>;
  };
  const words = (data.words ?? [])
    .filter((w) => w.type === "word" && w.text?.trim() && typeof w.start === "number" && typeof w.end === "number")
    .map((w) => ({ text: w.text!.trim(), start: w.start!, end: w.end!, speaker: w.speaker_id ?? "speaker_0" }));
  return { words, languageCode: data.language_code ?? null };
}

export type TimedSpeech = {
  audio: Buffer;
  /** Start time (s) of each character of `text` in the audio. */
  charStarts: number[];
  charEnds: number[];
};

/** TTS that also returns per-character timing, so one natural take can be cut at chunk boundaries. */
export async function synthesizeWithTimestamps(input: {
  voiceId: string;
  text: string;
  previousText?: string;
  nextText?: string;
  stability: number;
  style: number;
}): Promise<TimedSpeech> {
  const body = {
    text: input.text,
    model_id: TTS_MODEL,
    previous_text: input.previousText || undefined,
    next_text: input.nextText || undefined,
    voice_settings: { stability: input.stability, similarity_boost: 0.85, style: input.style, use_speaker_boost: true },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        audio_base64?: string;
        alignment?: { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] };
      };
      if (!data.audio_base64) throw new ServiceError("INTERNAL", "ElevenLabs returned no audio.");
      return {
        audio: Buffer.from(data.audio_base64, "base64"),
        charStarts: data.alignment?.character_start_times_seconds ?? [],
        charEnds: data.alignment?.character_end_times_seconds ?? [],
      };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    await failure(res, "text-to-speech");
  }
  throw new ServiceError("INTERNAL", "ElevenLabs text-to-speech failed.");
}

export async function synthesize(input: {
  voiceId: string;
  text: string;
  previousText?: string;
  nextText?: string;
  stability: number;
  style: number;
  speed?: number;
}): Promise<Buffer> {
  const body = {
    text: input.text,
    model_id: TTS_MODEL,
    previous_text: input.previousText || undefined,
    next_text: input.nextText || undefined,
    voice_settings: {
      stability: input.stability,
      similarity_boost: 0.85,
      style: input.style,
      use_speaker_boost: true,
      speed: input.speed ?? 1,
    },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE_URL}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    await failure(res, "text-to-speech");
  }
  throw new ServiceError("INTERNAL", "ElevenLabs text-to-speech failed.");
}
