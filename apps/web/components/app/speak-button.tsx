"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { useVoiceLanguage } from "~/lib/voice/languages";

const DEVANAGARI = /[ऀ-ॿ]/;

/** Strips markdown syntax so the speech doesn't read out "asterisk asterisk" etc. */
function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_#>~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads an assistant reply aloud in the language it was written in (or the user's speaking language). */
export function SpeakButton({ text }: { text: string }) {
  const [voiceLanguage] = useVoiceLanguage();
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(() => {
    const clean = toSpeechText(text);
    if (!clean) return;
    window.speechSynthesis.cancel();

    const lang = DEVANAGARI.test(clean) ? "hi-IN" : voiceLanguage;
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = lang;
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.split("-")[0]!));
    if (match) utterance.voice = match;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }, [text, voiceLanguage]);

  if (!supported) return null;

  return (
    <button
      type="button"
      className="thread-speak-btn"
      onClick={speaking ? stop : speak}
      aria-pressed={speaking}
      aria-label={speaking ? "Stop reading" : "Read this reply aloud"}
      title={speaking ? "Stop reading" : "Read aloud"}
    >
      {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
    </button>
  );
}
