"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";

import { UtteranceRecorder } from "~/lib/audio/speech-capture";
import { VOICE_LANGUAGES, useVoiceLanguage, voiceLanguageLabel } from "~/lib/voice/languages";

type Phase = "idle" | "starting" | "recording" | "transcribing";

const MAX_SECONDS = 28;

export async function transcribeWithGnani(wav: Blob, language: string): Promise<string> {
  const res = await fetch("/api-speech/transcribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "audio/wav", "x-thread-csrf": "1", "X-Language": language },
    body: wav,
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Voice transcription failed");
  return data.text ?? "";
}

/**
 * Push-to-talk mic: click (or Ctrl+Shift+Space) to talk, click again to stop. The clip is
 * trimmed of silence in the browser, then transcribed by Gnani in the chosen language.
 */
export function VoiceInputButton({
  onText,
  disabled,
  hotkey = false,
  showLanguage = true,
  size = "md",
}: {
  onText: (text: string) => void;
  disabled?: boolean;
  /** Bind Ctrl+Shift+Space. Enable on one button per page. */
  hotkey?: boolean;
  showLanguage?: boolean;
  size?: "sm" | "md";
}) {
  const [language, setLanguage] = useVoiceLanguage();
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const recorderRef = useRef<UtteranceRecorder | null>(null);
  const startedAtRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || phaseRef.current !== "recording") return;
    recorderRef.current = null;
    setPhase("transcribing");
    setLevel(0);
    try {
      const clip = await recorder.stop();
      if (!clip) {
        toast.message("Didn't catch any speech — try again.");
        return;
      }
      const text = await transcribeWithGnani(clip.wav, language);
      if (text) onText(text);
      else toast.message("Couldn't make out any words.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Voice input failed");
    } finally {
      setPhase("idle");
    }
  }, [language, onText]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle" || disabled) return;
    setPhase("starting");
    const recorder = new UtteranceRecorder({
      maxSec: MAX_SECONDS,
      onLevel: (l) => setLevel(l),
      onAutoStop: () => void stop(),
    });
    try {
      await recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setPhase("recording");
    } catch (error) {
      setPhase("idle");
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      toast.error(denied ? "Microphone access was blocked. Allow it in the address bar." : "Couldn't start the microphone.");
    }
  }, [disabled, stop]);

  const toggle = useCallback(() => {
    if (phaseRef.current === "recording") void stop();
    else if (phaseRef.current === "idle") void start();
  }, [start, stop]);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey, toggle]);

  useEffect(() => () => recorderRef.current?.cancel(), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const recording = phase === "recording";
  const busy = phase === "starting" || phase === "transcribing";
  const current = voiceLanguageLabel(language);
  const bars = [0.6, 1, 0.75].map((w) => Math.min(1, 0.15 + level * 14 * w));

  return (
    <div className="thread-voice" data-size={size} data-phase={phase} ref={menuRef}>
      <button
        type="button"
        className="thread-voice-btn"
        onClick={toggle}
        disabled={disabled || busy}
        aria-pressed={recording}
        aria-label={recording ? "Stop and transcribe" : "Speak to Thread"}
        title={recording ? "Stop and transcribe" : `Speak (${current.label})${hotkey ? " · Ctrl+Shift+Space" : ""}`}
      >
        {busy ? (
          <Loader2 size={size === "sm" ? 13 : 15} className="thread-spin" />
        ) : recording ? (
          <>
            <span className="thread-voice-bars" aria-hidden>
              {bars.map((h, i) => (
                <i key={i} style={{ transform: `scaleY(${h})` }} />
              ))}
            </span>
            <Square size={10} />
          </>
        ) : (
          <Mic size={size === "sm" ? 13 : 15} />
        )}
      </button>
      {recording ? <span className="thread-voice-time">{MAX_SECONDS - elapsed}s</span> : null}
      {showLanguage && !recording ? (
        <button
          type="button"
          className="thread-voice-lang"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy}
          aria-label={`Speaking language: ${current.label}`}
          title="Speaking language (Gnani)"
        >
          {current.short}
          <ChevronDown size={11} />
        </button>
      ) : null}
      {menuOpen ? (
        <div className="thread-voice-menu" role="menu">
          <div className="thread-voice-menu-head">Speaking language · Gnani</div>
          {VOICE_LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={l.code === language}
              onClick={() => {
                setLanguage(l.code);
                setMenuOpen(false);
              }}
            >
              <span>{l.label}</span>
              {l.code === language ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
