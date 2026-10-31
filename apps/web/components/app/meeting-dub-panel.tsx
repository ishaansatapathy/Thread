"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Download, Loader2, Mic, Square, Trash2 } from "lucide-react";

type Target = { code: string; label: string };
type DubStage = "extracting" | "transcribing" | "analyzing" | "translating" | "voices" | "voicing" | "mixing" | "done";
type DubRun = {
  status: "running" | "done" | "error";
  stage: DubStage;
  progress: { done: number; total: number } | null;
  target: string;
  error: string | null;
  notice: string | null;
  finishedAt: number | null;
  hasAudio: boolean;
  lines: Array<{ id: number; speaker: string; start: number; original: string; translation: string }>;
};

const STAGES: Array<{ key: DubStage; label: string }> = [
  { key: "transcribing", label: "Transcribe with word timing" },
  { key: "analyzing", label: "Measure pitch and loudness" },
  { key: "translating", label: "Translate and review" },
  { key: "voices", label: "Pick voices" },
  { key: "voicing", label: "Speak each phrase" },
  { key: "mixing", label: "Mix the audio" },
];

const READING = `Hi, this is my voice for Thread. I'm reading this so my meetings can be dubbed in my own voice.
Aaj ka plan simple hai: pehle inbox dekhenge, phir calendar, aur phir team ke saath ek quick sync.
Numbers, names and deadlines matter to me, so I speak them clearly — like Monday at 4:30, or twenty-five thousand rupees.
Kabhi main excited hota hun, kabhi bilkul calm — and that's exactly what I want my dubbed voice to keep.`;

const MIN_SECONDS = 25;
const MAX_SECONDS = 90;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api-meetings${path}`, {
    credentials: "include",
    ...init,
    headers: { "x-thread-csrf": "1", ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function clock(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function MyVoice({ onChange }: { onChange: (ready: boolean) => void }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sample, setSample] = useState<Blob | null>(null);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sample) {
      setSampleUrl(null);
      return;
    }
    const url = URL.createObjectURL(sample);
    setSampleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sample]);

  useEffect(() => {
    void call<{ ready: boolean }>("/voice")
      .then((d) => {
        setReady(d.ready);
        onChange(d.ready);
      })
      .catch(() => setReady(false));
  }, [onChange]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    if (timerRef.current) window.clearInterval(timerRef.current);
    setRecording(false);
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const parts: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setSample(new Blob(parts, { type: recorder.mimeType || "audio/webm" }));
      };
      recorderRef.current = recorder;
      setSample(null);
      setSeconds(0);
      recorder.start();
      setRecording(true);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setSeconds(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
    } catch {
      toast.error("Allow microphone access to record your voice.");
    }
  };

  useEffect(() => () => stop(), [stop]);

  const save = async () => {
    if (!sample || !consent) return;
    setSaving(true);
    try {
      await call("/voice", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Voice-Consent": "yes" },
        body: sample,
      });
      setReady(true);
      onChange(true);
      setSample(null);
      setConsent(false);
      toast.success("My voice is ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't set up your voice.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await call("/voice", { method: "DELETE" });
      setReady(false);
      onChange(false);
      toast.success("Your voice clone was deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete your voice.");
    }
  };

  if (ready === null) {
    return (
      <div className="thread-dub-block">
        <Loader2 size={14} className="thread-spin" />
      </div>
    );
  }

  return (
    <div className="thread-dub-block">
      <div className="thread-dub-block-head">
        <h4>My voice</h4>
        {ready ? (
          <span className="thread-dub-ok">
            <Check size={12} /> Ready
          </span>
        ) : null}
      </div>
      {ready && !recording && !sample ? (
        <>
          <p className="thread-dub-muted">Your own lines are dubbed in your voice. Nobody else&apos;s voice is ever cloned.</p>
          <div className="thread-dub-row">
            <button type="button" className="thread-room-btn" onClick={() => void start()}>
              <Mic size={13} /> Re-record
            </button>
            <button type="button" className="thread-room-btn" data-variant="danger" onClick={() => void remove()}>
              <Trash2 size={13} /> Delete my voice
            </button>
          </div>
        </>
      ) : (
        <>
          {!ready && !recording && !sample ? (
            <p className="thread-dub-muted">
              Record yourself reading the text below in a quiet room ({MIN_SECONDS}+ seconds). A clean sample is what makes the
              dub sound like you.
            </p>
          ) : null}
          {recording || sample ? <p className="thread-dub-reading">{READING}</p> : null}
          {recording ? (
            <div className="thread-dub-row">
              <span className="thread-dub-rec">
                <span className="thread-room-rec-dot" aria-hidden /> {clock(seconds)}
              </span>
              <button type="button" className="thread-room-btn" onClick={stop} disabled={seconds < MIN_SECONDS}>
                <Square size={12} /> {seconds < MIN_SECONDS ? `Keep reading (${Math.ceil(MIN_SECONDS - seconds)}s)` : "Stop"}
              </button>
            </div>
          ) : sample ? (
            <>
              {sampleUrl ? <audio controls src={sampleUrl} className="thread-dub-audio" /> : null}
              <label className="thread-dub-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>This is my own voice, and I agree to Thread creating a voice clone of it to dub what I say.</span>
              </label>
              <div className="thread-dub-row">
                <button type="button" className="thread-room-primary" onClick={() => void save()} disabled={!consent || saving}>
                  {saving ? <Loader2 size={13} className="thread-spin" /> : <Check size={13} />} Use this recording
                </button>
                <button type="button" className="thread-room-btn" onClick={() => void start()} disabled={saving}>
                  Record again
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="thread-room-primary" onClick={() => void start()}>
              <Mic size={13} /> Record my voice
            </button>
          )}
        </>
      )}
    </div>
  );
}

function AfterMeeting({ meetingId, ended, voiceReady }: { meetingId: string; ended: boolean; voiceReady: boolean }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [retention, setRetention] = useState(48);
  const [target, setTarget] = useState("en");
  const [saved, setSaved] = useState<number | null>(null);
  const [run, setRun] = useState<DubRun | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await call<{ savedAudioSeconds: number; run: DubRun | null }>(`/${meetingId}/dub`);
      setSaved(d.savedAudioSeconds);
      setRun(d.run);
    } catch {
      /* transient */
    }
  }, [meetingId]);

  useEffect(() => {
    void call<{ targets: Target[]; audioRetentionHours: number }>("/dub/options").then((d) => {
      setTargets(d.targets);
      setRetention(d.audioRetentionHours);
    });
    void load();
  }, [load]);

  useEffect(() => {
    if (run?.status !== "running") return;
    const t = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(t);
  }, [load, run?.status]);

  const start = async () => {
    setStarting(true);
    try {
      const d = await call<{ run: DubRun }>(`/${meetingId}/dub`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      setRun(d.run);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't start dubbing.");
    } finally {
      setStarting(false);
    }
  };

  const stageIndex = run ? STAGES.findIndex((s) => s.key === run.stage) : -1;

  return (
    <div className="thread-dub-block">
      <div className="thread-dub-block-head">
        <h4>Dub this meeting</h4>
      </div>
      {!ended ? (
        <p className="thread-dub-muted">
          Available once the meeting ends — if you ticked &ldquo;Save audio for dubbing&rdquo; before capturing. Audio is kept for{" "}
          {retention} hours.
        </p>
      ) : saved === 0 ? (
        <p className="thread-dub-muted">
          No audio was saved for this meeting, so it can&apos;t be dubbed. Next time tick &ldquo;Save audio for dubbing&rdquo; before
          you start the transcript.
        </p>
      ) : (
        <>
          <p className="thread-dub-muted">
            {saved ? `${clock(saved)} of saved audio. ` : ""}
            {voiceReady ? "Your lines use My voice; " : "Set up My voice to hear your lines in your own voice; "}
            other people get a natural stock voice.
          </p>
          <div className="thread-dub-row">
            <select
              className="thread-dub-select"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={run?.status === "running"}
              aria-label="Dub into"
            >
              {targets.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="thread-room-primary"
              onClick={() => void start()}
              disabled={starting || run?.status === "running" || !targets.length}
            >
              {run?.status === "running" ? "Dubbing…" : run?.status === "done" ? "Dub again" : "Dub meeting"}
            </button>
          </div>
        </>
      )}

      {run ? (
        <ol className="thread-dub-steps">
          {STAGES.map((stage, i) => {
            const state =
              run.status === "done" || i < stageIndex
                ? "done"
                : run.status === "error" && i === stageIndex
                  ? "error"
                  : run.status === "running" && i === stageIndex
                    ? "active"
                    : "pending";
            return (
              <li key={stage.key} data-state={state}>
                <span aria-hidden />
                {stage.label}
                {state === "active" && run.progress ? <em>{` ${run.progress.done}/${run.progress.total}`}</em> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {run?.status === "error" && run.error ? <p className="thread-dub-error">{run.error}</p> : null}
      {run?.notice ? <p className="thread-dub-muted">{run.notice}</p> : null}
      {run?.status === "done" && run.hasAudio ? (
        <>
          <audio
            key={run.finishedAt ?? 0}
            controls
            src={`/api-meetings/${meetingId}/dub/audio?v=${run.finishedAt}`}
            className="thread-dub-audio"
          />
          <a className="thread-room-btn" href={`/api-meetings/${meetingId}/dub/audio?download=1`}>
            <Download size={13} /> Download
          </a>
          <div className="thread-dub-lines">
            {run.lines.map((l) => (
              <div key={l.id}>
                <em>
                  {clock(l.start)} · {l.speaker === "you" ? "You" : l.speaker === "meeting" ? "Meeting" : "Speaker"}
                </em>
                <span>{l.original}</span>
                <strong>{l.translation}</strong>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function MeetingDubPanel({ meetingId, ended }: { meetingId: string; ended: boolean }) {
  const [voiceReady, setVoiceReady] = useState(false);
  return (
    <div className="thread-dub-panel">
      <MyVoice onChange={setVoiceReady} />
      <AfterMeeting meetingId={meetingId} ended={ended} voiceReady={voiceReady} />
      <div className="thread-dub-block">
        <div className="thread-dub-block-head">
          <h4>Live in the call</h4>
        </div>
        <p className="thread-dub-muted">
          In the Thread Chrome extension&apos;s Meet panel you can turn on <strong>Speak in another language</strong> (the call
          hears you translated, in My voice) or <strong>Hear the call in my language</strong>. Both are off until you switch them
          on, and only change audio.
        </p>
      </div>
    </div>
  );
}
