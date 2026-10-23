"use client";

import { useCallback, useEffect, useState } from "react";

/** Gnani Prisma languages. Hinglish and other code-mixed speech work under the base language. */
export const VOICE_LANGUAGES = [
  { code: "en-IN", label: "English", short: "EN" },
  { code: "hi-IN", label: "Hindi / Hinglish", short: "HI" },
  { code: "bn-IN", label: "Bengali", short: "BN" },
  { code: "ta-IN", label: "Tamil", short: "TA" },
  { code: "te-IN", label: "Telugu", short: "TE" },
  { code: "kn-IN", label: "Kannada", short: "KN" },
  { code: "ml-IN", label: "Malayalam", short: "ML" },
  { code: "mr-IN", label: "Marathi", short: "MR" },
  { code: "gu-IN", label: "Gujarati", short: "GU" },
  { code: "pa-IN", label: "Punjabi", short: "PA" },
] as const;

export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]["code"];

const STORAGE_KEY = "thread.voice.language";
const CHANGE_EVENT = "thread:voice-language";

function isVoiceLanguage(value: string | null): value is VoiceLanguage {
  return VOICE_LANGUAGES.some((l) => l.code === value);
}

export function voiceLanguageLabel(code: string) {
  return VOICE_LANGUAGES.find((l) => l.code === code) ?? VOICE_LANGUAGES[0];
}

/** The user's speaking language, shared by every mic in the app and remembered per browser. */
export function useVoiceLanguage(): [VoiceLanguage, (next: VoiceLanguage) => void] {
  const [language, setLanguage] = useState<VoiceLanguage>("en-IN");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isVoiceLanguage(stored)) setLanguage(stored);
    } catch {
      /* storage blocked */
    }
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (isVoiceLanguage(next)) setLanguage(next);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  const update = useCallback((next: VoiceLanguage) => {
    setLanguage(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  }, []);

  return [language, update];
}
