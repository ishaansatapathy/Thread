"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";

export type DubStage = "extracting" | "transcribing" | "analyzing" | "translating" | "cloning" | "voicing" | "mixing" | "done";

export type DubChunk = {
  start: number;
  end: number;
  source: string;
  text: string;
  tempo: number | null;
  sync: number | null;
  syncBefore: number | null;
};

export type DubLine = {
  id: number;
  speaker: string;
  start: number;
  end: number;
  original: string;
  resolved: string;
  translation: string;
  tone: "excited" | "calm" | "serious" | "neutral";
  fixedByReview: boolean;
  chunks: DubChunk[];
};

export type DubRun = {
  status: "running" | "done" | "error";
  stage: DubStage;
  progress: { done: number; total: number } | null;
  target: string;
  sourceLanguage: string;
  transcriber: "scribe" | "gnani" | null;
  syncScore: number | null;
  error: string | null;
  notice: string | null;
  lines: DubLine[];
  startedAt: number;
  finishedAt: number | null;
};

export type DubJob = {
  id: string;
  status: "downloading" | "ready" | "error";
  sourceKind: "upload" | "youtube" | "drive" | "direct" | "web";
  sourceLabel: string;
  title: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  error: string | null;
  createdAt: number;
  dub: DubRun | null;
};

type Option = { code: string; label: string };

const STAGES: Array<{ key: DubStage; label: string }> = [
  { key: "extracting", label: "Extract audio" },
  { key: "transcribing", label: "Transcribe with word timing" },
  { key: "analyzing", label: "Measure pitch and energy" },
  { key: "translating", label: "Translate and review" },
  { key: "cloning", label: "Clone voice" },
  { key: "voicing", label: "Voice each phrase" },
  { key: "mixing", label: "Mix and render" },
];

function fmtTime(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

export function DubStudio({ job, onStarted }: { job: DubJob; onStarted: () => void }) {
  const run = job.dub;
  const [targets, setTargets] = useState<Option[]>([]);
  const [sources, setSources] = useState<Option[]>([]);
  const [target, setTarget] = useState(run?.target ?? "hinglish");
  const [source, setSource] = useState(run?.sourceLanguage ?? "hi-IN");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"original" | "dubbed">(run?.status === "done" ? "dubbed" : "original");
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);

  useEffect(() => {
    void fetch("/api-dub/options", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { targets: Option[]; sources: Option[] } | null) => {
        if (!d) return;
        setTargets(d.targets);
        setSources(d.sources);
      })
      .catch(() => undefined);
  }, []);

  const done = run?.status === "done";
  const running = run?.status === "running";
  useEffect(() => {
    if (done) setView("dubbed");
  }, [done, run?.finishedAt]);

  const switchView = (next: "original" | "dubbed") => {
    if (next === view) return;
    pendingSeek.current = videoRef.current?.currentTime ?? 0;
    setView(next);
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api-dub/jobs/${job.id}/dub`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-thread-csrf": "1" },
        body: JSON.stringify({ target, source }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not start dubbing");
      }
      setView("original");
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start dubbing");
    } finally {
      setStarting(false);
    }
  };

  const stageIndex = run ? STAGES.findIndex((s) => s.key === run.stage) : -1;
  const lines = useMemo(() => run?.lines.filter((l) => l.original) ?? [], [run?.lines]);
  const currentLine = lines.find((l) => currentTime >= l.start - 0.05 && currentTime < l.end + 0.3)?.id ?? null;
  const videoSrc =
    view === "dubbed" && done ? `/api-dub/jobs/${job.id}/output?v=${run?.finishedAt}` : `/api-dub/jobs/${job.id}/video`;
  const targetLabel = targets.find((t) => t.code === run?.target)?.label ?? run?.target;

  const seek = (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t;
    void video.play().catch(() => undefined);
  };

  return (
    <>
      <div className="thread-dub-grid">
        <section className="thread-dub-card thread-dub-stage">
          <div className="thread-dub-stage-bar">
            <div className="thread-dub-segment" role="group" aria-label="Video track">
              <button type="button" aria-pressed={view === "original"} onClick={() => switchView("original")}>
                Original
              </button>
              <button type="button" aria-pressed={view === "dubbed"} onClick={() => switchView("dubbed")} disabled={!done}>
                Dubbed
              </button>
            </div>
            {done ? <span className="thread-mono-tag">{targetLabel}</span> : null}
          </div>
          <video
            ref={videoRef}
            key={videoSrc}
            src={videoSrc}
            className="thread-dub-video"
            controls
            playsInline
            onLoadedMetadata={(e) => {
              if (pendingSeek.current !== null) {
                e.currentTarget.currentTime = pendingSeek.current;
                pendingSeek.current = null;
                void e.currentTarget.play().catch(() => undefined);
              }
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          />
          <div className="thread-dub-caption">{job.title}</div>
        </section>

        <aside className="thread-dub-card thread-dub-panel">
          <span className="thread-dub-panel-title">Dub settings</span>
          <div>
            <label className="thread-set-label" htmlFor="dub-source">
              Spoken in
            </label>
            <select
              id="dub-source"
              className="thread-set-input thread-dub-select"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={running}
            >
              {sources.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="thread-set-label" htmlFor="dub-target">
              Dub into
            </label>
            <select
              id="dub-target"
              className="thread-set-input thread-dub-select"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={running}
            >
              {targets.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="thread-dub-btn"
            data-variant="primary"
            onClick={() => void start()}
            disabled={running || starting || targets.length === 0}
          >
            {running ? "Dubbing…" : starting ? "Starting…" : done ? "Dub again" : "Start dub"}
          </button>

          {error ? (
            <div className="thread-dub-alert" role="alert">
              <AlertTriangle size={14} />
              {error}
            </div>
          ) : null}

          {run ? (
            <ol className="thread-dub-steps" aria-label="Progress">
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
                  <li key={stage.key} className="thread-dub-step" data-state={state}>
                    <span className="thread-dub-step-mark" aria-hidden />
                    <span>{stage.label}</span>
                    {state === "active" && run.progress ? (
                      <span className="thread-dub-step-count">
                        {run.progress.done}/{run.progress.total}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}

          {run?.status === "error" && run.error ? (
            <div className="thread-dub-alert" role="alert">
              <AlertTriangle size={14} />
              {run.error}
            </div>
          ) : null}
          {run?.notice ? (
            <div className="thread-dub-alert" data-tone="warn">
              <AlertTriangle size={14} />
              {run.notice}
            </div>
          ) : null}

          {done ? (
            <a className="thread-dub-btn" href={`/api-dub/jobs/${job.id}/output?download=1`}>
              <Download size={14} />
              Download
            </a>
          ) : null}
        </aside>
      </div>

      {lines.some((l) => l.translation) ? (
        <section className="thread-dub-card">
          <div className="thread-dub-script-head">
            <h3>Script</h3>
            <span className="thread-mono-tag">
              {lines.length} lines · {lines.reduce((n, l) => n + l.chunks.length, 0)} phrases
              {run?.transcriber ? ` · timing by ${run.transcriber === "scribe" ? "Scribe" : "Gnani"}` : ""}
              {run?.syncScore !== null && run?.syncScore !== undefined ? ` · rhythm match ${run.syncScore}%` : ""}
            </span>
          </div>
          {lines.map((line) => (
            <button
              key={line.id}
              type="button"
              className="thread-dub-row"
              data-current={currentLine === line.id}
              onClick={() => seek(line.start)}
            >
              <span className="thread-dub-row-time">
                {fmtTime(line.start)}
                <span>{line.tone}</span>
              </span>
              <span>
                <span className="thread-dub-row-source" style={{ display: "block" }}>
                  {line.original}
                </span>
                {line.resolved && norm(line.resolved) !== norm(line.original) ? (
                  <span className="thread-dub-row-resolved" style={{ display: "block" }}>
                    Read as: {line.resolved}
                  </span>
                ) : null}
              </span>
              <span className="thread-dub-row-target">
                {line.chunks.every((c) => c.text)
                  ? line.chunks.map((c, i) => (
                      <span key={i} className="thread-dub-chunk" title={`${fmtTime(c.start)} · ${(c.end - c.start).toFixed(1)}s`}>
                        {c.text}
                      </span>
                    ))
                  : line.translation || "…"}
                {line.fixedByReview ? (
                  <span className="thread-dub-row-tags" style={{ display: "flex" }}>
                    <span className="thread-mono-tag">refined in review</span>
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </section>
      ) : null}
    </>
  );
}
