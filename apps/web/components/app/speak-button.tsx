"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";

import { useVoiceLanguage } from "~/lib/voice/languages";

const DEVANAGARI = /[ऀ-ॿ]/;
const MAX_CHARS = 4500;

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

/**
 * Reads an assistant reply aloud with a Gnani voice, in the language it was written in (or the
 * user's speaking language). Falls back to the browser's built-in voice if Gnani can't be reached,
 * so the button never goes silent.
 */
export function SpeakButton({ text }: { text: string }) {
  const [voiceLanguage] = useVoiceLanguage();
  const [state, setState] = useState<"idle" | "loading" | "speaking">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [browserTts, setBrowserTts] = useState(false);

  useEffect(() => {
    setBrowserTts(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setState("idle");
  }, []);

  useEffect(() => stop, [stop]);

  const speakWithBrowser = useCallback(
    (clean: string, lang: string) => {
      if (!browserTts) return setState("idle");
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = lang;
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.split("-")[0]!));
      if (match) utterance.voice = match;
      utterance.onend = () => setState("idle");
      utterance.onerror = () => setState("idle");
      window.speechSynthesis.speak(utterance);
      setState("speaking");
    },
    [browserTts],
  );

  const speak = useCallback(async () => {
    const clean = toSpeechText(text).slice(0, MAX_CHARS);
    if (!clean) return;
    stop();
    const language = DEVANAGARI.test(clean) ? "hi-IN" : voiceLanguage;
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    try {
      const res = await fetch("/api-speech/speak", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-thread-csrf": "1" },
        body: JSON.stringify({ text: clean, language }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = stop;
      audio.onerror = stop;
      await audio.play();
      setState("speaking");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      speakWithBrowser(clean, language);
    }
  }, [speakWithBrowser, stop, text, voiceLanguage]);

  return (
    <button
      type="button"
      className="thread-speak-btn"
      onClick={state === "idle" ? () => void speak() : stop}
      aria-pressed={state === "speaking"}
      aria-label={state === "idle" ? "Read this reply aloud" : "Stop reading"}
      title={state === "idle" ? "Read aloud (Gnani)" : "Stop reading"}
    >
      {state === "loading" ? <Loader2 size={13} className="thread-spin" /> : state === "speaking" ? <VolumeX size={13} /> : <Volume2 size={13} />}
    </button>
  );
}
