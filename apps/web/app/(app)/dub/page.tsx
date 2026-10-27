"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Trash2, Upload } from "lucide-react";

import { DubStudio, type DubJob } from "./dub-studio";

const MAX_BYTES = 200 * 1024 * 1024;
const VIDEO_NAME = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;
const SOURCE_LABELS: Record<DubJob["sourceKind"], string> = {
  upload: "Upload",
  youtube: "YouTube",
  drive: "Drive",
  direct: "Link",
  web: "Web",
};

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function readError(res: Response, fallback: string) {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function jobStatus(job: DubJob): { label: string; state: "busy" | "done" | "idle" | "error" } {
  if (job.status === "downloading") return { label: "fetching", state: "busy" };
  if (job.status === "error") return { label: "failed", state: "error" };
  if (job.dub?.status === "running") return { label: "dubbing", state: "busy" };
  if (job.dub?.status === "done") return { label: `dubbed · ${job.dub.target}`, state: "done" };
  if (job.dub?.status === "error") return { label: "dub failed", state: "error" };
  return { label: "ready", state: "idle" };
}

export default function DubPage() {
  const [jobs, setJobs] = useState<DubJob[]>([]);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"link" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api-dub/jobs", { credentials: "include" });
      if (res.ok) setJobs(((await res.json()) as { jobs: DubJob[] }).jobs);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasPending = jobs.some((j) => j.status === "downloading" || j.dub?.status === "running");
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [hasPending, refresh]);

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;

  const submitLink = async () => {
    const url = link.trim();
    if (!url || busy) return;
    setBusy("link");
    setError(null);
    try {
      const res = await fetch("/api-dub/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-thread-csrf": "1" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not start that download"));
      const job = (await res.json()) as DubJob;
      setLink("");
      setSelectedId(job.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start that download");
    } finally {
      setBusy(null);
    }
  };

  const uploadFile = async (file: File) => {
    if (busy) return;
    setError(null);
    if (!file.type.startsWith("video/") && !VIDEO_NAME.test(file.name)) {
      setError("Choose a video file (mp4, mov, webm, mkv).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Videos can be up to 200 MB.");
      return;
    }
    setBusy("upload");
    try {
      const res = await fetch("/api-dub/jobs/upload", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-thread-csrf": "1",
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Type": file.type || "video/mp4",
        },
        body: file,
      });
      if (!res.ok) throw new Error(await readError(res, "Could not upload that video"));
      const job = (await res.json()) as DubJob;
      setSelectedId(job.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload that video");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api-dub/jobs/${id}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "x-thread-csrf": "1" },
    }).catch(() => undefined);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  return (
    <div className="thread-dub">
      <header className="thread-dub-hero">
        <h2>Dub</h2>
        <p>
          Translate a video into another language in the speaker&apos;s own voice. Every phrase is placed back on the
          speaker&apos;s original timing, pauses included.
        </p>
      </header>

      <section
        className="thread-dub-card thread-dub-intake"
        data-dragging={dragging}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void uploadFile(file);
        }}
      >
        <div className="thread-dub-intake-row">
          <input
            className="thread-set-input"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitLink();
            }}
            placeholder="Paste a YouTube, Google Drive or video link"
            aria-label="Video link"
          />
          <button
            type="button"
            className="thread-dub-btn"
            data-variant="primary"
            onClick={() => void submitLink()}
            disabled={busy !== null || !link.trim()}
          >
            {busy === "link" ? <Loader2 size={14} style={{ animation: "thread-spin 1s linear infinite" }} /> : null}
            Fetch
          </button>
          <button type="button" className="thread-dub-btn" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === "upload" ? (
              <Loader2 size={14} style={{ animation: "thread-spin 1s linear infinite" }} />
            ) : (
              <Upload size={14} />
            )}
            {busy === "upload" ? "Uploading" : "Upload"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*,.mkv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
        </div>
        <span className="thread-dub-hint">or drop a file here · up to 5 min · 200 MB</span>
        {error ? (
          <div className="thread-dub-alert" role="alert">
            <AlertTriangle size={14} />
            {error}
          </div>
        ) : null}
      </section>

      {jobs.length > 0 ? (
        <div className="thread-dub-card thread-dub-library">
          {jobs.map((job) => {
            const status = jobStatus(job);
            const meta =
              job.status === "error"
                ? job.error
                : [SOURCE_LABELS[job.sourceKind], formatDuration(job.durationSeconds), formatSize(job.sizeBytes)]
                    .filter(Boolean)
                    .join(" · ");
            return (
              <div
                key={job.id}
                role="button"
                tabIndex={0}
                className="thread-dub-item"
                data-active={selected?.id === job.id}
                onClick={() => setSelectedId(job.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelectedId(job.id);
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="thread-dub-item-title">{job.title}</div>
                  <div className="thread-dub-item-meta" data-error={job.status === "error"}>
                    {meta}
                  </div>
                </div>
                <span className="thread-dub-status" data-state={status.state}>
                  {status.state === "busy" ? (
                    <Loader2 size={12} style={{ animation: "thread-spin 1s linear infinite" }} />
                  ) : null}
                  {status.label}
                </span>
                <button
                  type="button"
                  className="thread-dub-iconbtn"
                  aria-label={`Remove ${job.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(job.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {selected && selected.status === "ready" ? (
        <DubStudio key={selected.id} job={selected} onStarted={() => void refresh()} />
      ) : null}
    </div>
  );
}
