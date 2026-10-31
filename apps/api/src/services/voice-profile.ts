/**
 * "My voice": one voice clone per user, made from a clean sample the user records themselves and
 * explicitly consents to. It is the only cloned voice Thread uses — other meeting participants are
 * voiced with stock voices, because they never agreed to be cloned.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "@repo/services/errors";

import { decodeToF32, detectSpeech, f32ToWav16 } from "./dub-media";
import { cloneVoice, deleteVoice, findClonedVoices } from "./elevenlabs";

export const MIN_PROFILE_SPEECH_SECONDS = 20;
export const MAX_PROFILE_BYTES = 15 * 1024 * 1024;
const SAMPLE_RATE = 44100;

const profileName = (userId: string) => `Thread voice ${userId}`;
const cache = new Map<string, string | null>();

export async function getVoiceProfile(userId: string): Promise<string | null> {
  if (cache.has(userId)) return cache.get(userId)!;
  const [voiceId] = await findClonedVoices(profileName(userId));
  cache.set(userId, voiceId ?? null);
  return voiceId ?? null;
}

/** Replaces the user's voice with a clone of `sample` (any browser recording format). */
export async function createVoiceProfile(userId: string, sample: Buffer): Promise<string> {
  const dir = path.join(os.tmpdir(), "thread-voice", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const input = path.join(dir, "sample.bin");
    await writeFile(input, sample);
    let pcm: Float32Array;
    try {
      pcm = await decodeToF32(input, path.join(dir, "sample.f32"), SAMPLE_RATE);
    } catch {
      throw new ServiceError("BAD_REQUEST", "Couldn't read that recording. Try recording again.");
    }
    const speech = detectSpeech(pcm, SAMPLE_RATE, 30).reduce((n, r) => n + (r.end - r.start), 0);
    if (speech < MIN_PROFILE_SPEECH_SECONDS) {
      throw new ServiceError(
        "BAD_REQUEST",
        `We heard about ${Math.round(speech)} seconds of speech. Read for at least ${MIN_PROFILE_SPEECH_SECONDS} seconds so your voice comes out right.`,
      );
    }

    const voiceId = await cloneVoice(
      profileName(userId),
      { data: f32ToWav16(pcm, SAMPLE_RATE), filename: "my-voice.wav", mimeType: "audio/wav" },
      "Thread 'My voice' — recorded and approved by the user for dubbing their own speech.",
    );
    // Only after the new clone exists, remove older ones so the user is never left without a voice.
    const older = (await findClonedVoices(profileName(userId))).filter((id) => id !== voiceId);
    await Promise.all(older.map((id) => deleteVoice(id)));
    cache.set(userId, voiceId);
    return voiceId;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function deleteVoiceProfile(userId: string): Promise<void> {
  const ids = await findClonedVoices(profileName(userId));
  await Promise.all(ids.map((id) => deleteVoice(id)));
  cache.set(userId, null);
}

/** Premade ElevenLabs voices for people who haven't consented to a clone, matched by pitch. */
export function stockVoice(pitchHz: number): string {
  const male = process.env.ELEVENLABS_FALLBACK_VOICE_MALE?.trim() || "iP95p4xoKVk53GoZ742B";
  const female = process.env.ELEVENLABS_FALLBACK_VOICE_FEMALE?.trim() || "hpp4J3VqNfWAUOO0d1Us";
  return pitchHz >= 165 ? female : male;
}
