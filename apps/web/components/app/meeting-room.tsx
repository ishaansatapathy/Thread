"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  CalendarPlus,
  Check,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  GraduationCap,
  Languages,
  Loader2,
  Mail,
  Maximize2,
  Mic,
  Minimize2,
  MonitorUp,
  PictureInPicture2,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Users,
  Video,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import { AgentMarkdown } from "~/components/app/agent-markdown";
import { VoiceInputButton } from "~/components/app/voice-input-button";
import { MeetingDubPanel } from "~/components/app/meeting-dub-panel";
import { useAgentStream, type StreamActionCard } from "~/lib/agent/use-agent-stream";
import { CaptureError, useMeetingCapture, type LiveSegment } from "~/lib/meetings/use-meeting-capture";
import { VOICE_LANGUAGES, useVoiceLanguage, voiceLanguageLabel } from "~/lib/voice/languages";

type Notes = { summary: string; keyPoints: string[]; decisions: string[]; actionItems: Array<{ action: string; owner?: string; deadline?: string }> };

function clock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function speakerName(id: string) {
  if (id === "you") return "You";
  if (id === "meeting") return "Meeting";
  if (id === "room") return "Room";
  return `Speaker ${id}`;
}

function segmentKey(s: LiveSegment) {
  return `${s.speakerId}|${s.startTime}|${s.text}`;
}

const NOTE_ACTIONS: Array<{ label: string; icon: typeof Mail; prompt: string }> = [
  {
    label: "Email the notes",
    icon: Mail,
    prompt:
      "Draft a follow-up email for this meeting with a 2-line summary, the decisions and the action items with owners. Ask me who to send it to if you can't tell from the meeting.",
  },
  {
    label: "Save as Google Doc",
    icon: FileText,
    prompt: "Create a Google Doc of this meeting's notes: summary, key points, decisions, and an action items table.",
  },
  {
    label: "Action items → Sheet",
    icon: FileSpreadsheet,
    prompt: "Create a Google Sheet tracker of this meeting's action items with columns Action, Owner, Deadline, Status.",
  },
  {
    label: "Schedule follow-up",
    icon: CalendarPlus,
    prompt: "Propose a follow-up meeting for this meeting's open items and queue a calendar invite with a Meet link.",
  },
  {
    label: "Post to Classroom",
    icon: GraduationCap,
    prompt: "Turn this meeting/lecture into a short Classroom announcement with the key points and any assignments, for the right course.",
  },
  {
    label: "Slides recap",
    icon: ClipboardList,
    prompt: "Make a short Google Slides recap of this meeting: one slide per main topic plus a decisions and next-steps slide.",
  },
];

const ASK_CHIPS = [
  "What did I miss in the last 5 minutes?",
  "What has been decided so far?",
  "Who owns which action item?",
  "Summarise this in Hindi",
  "Draft a reply to the last question",
];

// ─────────────────────────────────────────────────────────────────────────────
// Document Picture-in-Picture: float a mini room above the Meet tab.
// ─────────────────────────────────────────────────────────────────────────────

type PipApi = { requestWindow: (opts: { width: number; height: number }) => Promise<Window> };

function getPipApi(): PipApi | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture ?? null;
}

function useDocumentPip() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(getPipApi() !== null);
  }, []);

  const open = useCallback(async () => {
    const api = getPipApi();
    if (!api) return;
    const win = await api.requestWindow({ width: 400, height: 560 });
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      win.document.head.appendChild(node.cloneNode(true));
    });
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.className = `${document.body.className} thread-page thread-app thread-pip-body`;
    win.document.title = "Thread · Meeting";
    win.addEventListener("pagehide", () => setPipWindow(null));
    setPipWindow(win);
  }, []);

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
  }, [pipWindow]);

  return { supported, pipWindow, open, close };
}

// ─────────────────────────────────────────────────────────────────────────────

function TranscriptView({ segments, live, compact }: { segments: LiveSegment[]; live: boolean; compact?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  useLayoutEffect(() => {
    if (!following) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments.length, following]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  const shown = compact ? segments.slice(-8) : segments;

  return (
    <div className="thread-room-transcript-wrap">
      <div className="thread-room-transcript" ref={scrollRef} onScroll={onScroll} data-compact={compact ? "true" : undefined}>
        {shown.length === 0 ? (
          <div className="thread-room-empty">
            {live ? (
              <>
                <span className="thread-room-pulse" aria-hidden />
                Listening… lines appear here a few seconds after each pause.
              </>
            ) : (
              "No transcript yet."
            )}
          </div>
        ) : (
          shown.map((s, i) => {
            const prev = shown[i - 1];
            const sameSpeaker = prev?.speakerId === s.speakerId && s.startTime - prev.endTime < 20;
            return (
              <div key={segmentKey(s)} className="thread-room-line" data-speaker={s.speakerId} data-continued={sameSpeaker ? "true" : undefined}>
                {!sameSpeaker ? (
                  <div className="thread-room-line-head">
                    <span className="thread-room-speaker">{speakerName(s.speakerId)}</span>
                    <span className="thread-room-time">{clock(s.startTime)}</span>
                  </div>
                ) : null}
                <p>{s.text}</p>
              </div>
            );
          })
        )}
      </div>
      {!following && segments.length > 0 ? (
        <button
          type="button"
          className="thread-room-jump"
          onClick={() => {
            setFollowing(true);
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          <ArrowDown size={12} /> Latest
        </button>
      ) : null}
    </div>
  );
}

function ActionCards({ actions }: { actions: StreamActionCard[] }) {
  if (!actions.length) return null;
  return (
    <div className="thread-room-actions">
      {actions.map((a, i) => (
        <div key={`${a.title}-${i}`} className="thread-room-action" data-disposition={a.disposition}>
          <Check size={13} />
          <div>
            <strong>{a.title}</strong>
            {a.detail ? <span>{a.detail}</span> : null}
          </div>
          {a.kind.endsWith("_queued") || a.disposition === "queued" ? (
            <Link href="/queue" className="thread-room-action-link">
              Review
            </Link>
          ) : a.href ? (
            <a href={a.href} target={a.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="thread-room-action-link">
              Open
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AskPanel({
  agent,
  compact,
  disabled,
}: {
  agent: ReturnType<typeof useAgentStream>;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.messages, agent.status]);

  const submit = (text: string) => {
    if (!text.trim() || agent.pending) return;
    void agent.send(text);
    setDraft("");
  };

  const shown = compact ? agent.messages.slice(-2) : agent.messages;

  return (
    <div className="thread-room-ask" data-compact={compact ? "true" : undefined}>
      <div className="thread-room-ask-list" ref={listRef}>
        {shown.length === 0 && !compact ? (
          <div className="thread-room-ask-intro">
            <p>
              Ask about the meeting while it&apos;s happening, or tell Thread to act on it — email, Docs, Sheets, Calendar,
              Classroom. Every change still waits in Queue.
            </p>
            <div className="thread-room-chips">
              {ASK_CHIPS.map((c) => (
                <button key={c} type="button" onClick={() => submit(c)} disabled={disabled || agent.pending}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {shown.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="thread-room-msg" data-role="user">
              {m.content}
            </div>
          ) : (
            <div key={i} className="thread-room-msg" data-role="assistant">
              <AgentMarkdown text={m.content} />
            </div>
          ),
        )}
        {agent.pending && agent.messages.at(-1)?.role !== "assistant" ? (
          <div className="thread-room-msg" data-role="assistant">
            <span className="thread-chat-status">{agent.status ?? "Thinking…"}</span>
          </div>
        ) : null}
        {agent.error ? <div className="thread-room-msg-error">{agent.error}</div> : null}
        {!compact ? <ActionCards actions={agent.actions} /> : null}
      </div>
      <form
        className="thread-room-ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(draft);
            }
          }}
          placeholder={compact ? "Ask Thread…" : "Ask or tell Thread… (speak with the mic)"}
          disabled={disabled}
          aria-label="Ask Thread about this meeting"
        />
        <VoiceInputButton
          size="sm"
          showLanguage={false}
          disabled={disabled || agent.pending}
          onText={(text) => submit(text)}
        />
        {agent.pending ? (
          <button type="button" className="thread-room-send" onClick={agent.stop} aria-label="Stop">
            <Square size={12} />
          </button>
        ) : (
          <button type="submit" className="thread-room-send" disabled={disabled || !draft.trim()} aria-label="Send">
            <ArrowUp size={15} />
          </button>
        )}
      </form>
    </div>
  );
}

function NotesPanel({
  notes,
  coveredLines,
  totalLines,
  refreshing,
  onRefresh,
  onAction,
  disabled,
}: {
  notes: Notes | null;
  coveredLines: number;
  totalLines: number;
  refreshing: boolean;
  onRefresh: () => void;
  onAction: (prompt: string) => void;
  disabled?: boolean;
}) {
  const hasNotes = Boolean(notes && (notes.summary || notes.keyPoints.length || notes.actionItems.length));
  const pending = totalLines - coveredLines;
  return (
    <div className="thread-room-notes">
      <div className="thread-room-notes-head">
        <span>
          {hasNotes
            ? pending > 0
              ? `Covers ${coveredLines} of ${totalLines} lines`
              : "Up to date"
            : totalLines > 0
              ? "Notes build up as people talk"
              : "Notes appear once there's a transcript"}
        </span>
        <button type="button" onClick={onRefresh} disabled={disabled || refreshing || pending === 0} title="Fold the latest lines into the notes">
          {refreshing ? <Loader2 size={12} className="thread-spin" /> : <RefreshCw size={12} />}
          Update
        </button>
      </div>

      {hasNotes && notes ? (
        <div className="thread-room-notes-body">
          {notes.summary ? <p className="thread-room-summary">{notes.summary}</p> : null}
          {notes.decisions.length ? (
            <section>
              <h4>Decisions</h4>
              <ul>
                {notes.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {notes.actionItems.length ? (
            <section>
              <h4>Action items</h4>
              <ul className="thread-room-todos">
                {notes.actionItems.map((a, i) => (
                  <li key={i}>
                    <span className="thread-room-todo-box" aria-hidden />
                    <span>
                      {a.action}
                      {a.owner || a.deadline ? (
                        <em>
                          {[a.owner, a.deadline].filter(Boolean).join(" · ")}
                        </em>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {notes.keyPoints.length ? (
            <section>
              <h4>Key points</h4>
              <ul>
                {notes.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="thread-room-notes-actions">
        <h4>Do something with it</h4>
        <div>
          {NOTE_ACTIONS.map((a) => (
            <button key={a.label} type="button" onClick={() => onAction(a.prompt)} disabled={disabled || totalLines === 0}>
              <a.icon size={13} />
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CaptureMenu({
  disabled,
  hasMeetLink,
  onStart,
}: {
  disabled?: boolean;
  hasMeetLink: boolean;
  onStart: (mode: "both" | "tab" | "mic" | "room") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const options: Array<{ mode: "both" | "tab" | "mic" | "room"; icon: typeof Mic; title: string; detail: string }> = [
    {
      mode: "both",
      icon: MonitorUp,
      title: "Meet tab + my mic",
      detail: "Best for online calls. Lines are labelled You / Meeting. Use headphones.",
    },
    { mode: "tab", icon: Video, title: "Meet tab only", detail: "Transcribe the call without your mic." },
    { mode: "room", icon: Users, title: "In-person meeting", detail: "One mic hears everyone in the room." },
    { mode: "mic", icon: Mic, title: "Just me", detail: "Dictate notes or think out loud." },
  ];

  return (
    <div className="thread-room-capture" ref={ref}>
      <button type="button" className="thread-room-primary" onClick={() => setOpen((v) => !v)} disabled={disabled} aria-expanded={open}>
        <span className="thread-room-rec-dot" aria-hidden />
        Start live transcript
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="thread-room-menu" role="menu">
          {options.map((o) => (
            <button
              key={o.mode}
              type="button"
              role="menuitem"
              data-recommended={o.mode === "both" && hasMeetLink ? "true" : undefined}
              onClick={() => {
                setOpen(false);
                onStart(o.mode);
              }}
            >
              <o.icon size={15} />
              <span>
                <strong>{o.title}</strong>
                <small>{o.detail}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MeetingRoom({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery({});
  const serviceStatus = trpc.meetings.status.useQuery({}, { staleTime: 60_000 });
  const [language, setLanguage] = useVoiceLanguage();
  const [liveSegments, setLiveSegments] = useState<LiveSegment[]>([]);
  const [fatal, setFatal] = useState<CaptureError | null>(null);
  const [panel, setPanel] = useState<"ask" | "notes" | "dub">("ask");
  const [keepAudio, setKeepAudio] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [liveSince, setLiveSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const capture = useMeetingCapture({
    meetingId,
    language,
    keepAudio,
    onSegment: (segment) => setLiveSegments((prev) => [...prev, segment]),
    onFatal: (error) => setFatal(error),
  });
  const capturing = capture.state === "live" || capture.state === "starting";

  const meetingQuery = trpc.meetings.get.useQuery(
    { id: meetingId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "processing") return 5_000;
        if (capturing) return 20_000;
        return false;
      },
    },
  );
  const meeting = meetingQuery.data;

  const agent = useAgentStream({ meetingId, userEmail: me.data?.email });
  const pip = useDocumentPip();

  const invalidate = useCallback(() => {
    void utils.meetings.get.invalidate({ id: meetingId });
    void utils.meetings.list.invalidate();
  }, [meetingId, utils]);

  const rename = trpc.meetings.rename.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const refresh = trpc.meetings.refreshNotes.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const end = trpc.meetings.end.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Meeting ended — notes are ready.");
      setPanel("notes");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.meetings.remove.useMutation({
    onSuccess: () => {
      void utils.meetings.list.invalidate();
      router.push("/apps/meet");
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!fatal) return;
    toast.error(fatal.message);
    void capture.stop();
    setLiveSince(null);
    setFatal(null);
    invalidate();
  }, [capture, fatal, invalidate]);

  useEffect(() => {
    if (!liveSince) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [liveSince]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const segments = useMemo(() => {
    const seen = new Set<string>();
    const out: LiveSegment[] = [];
    for (const s of [...(meeting?.segments ?? []), ...liveSegments]) {
      const key = segmentKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out.sort((a, b) => a.startTime - b.startTime);
  }, [liveSegments, meeting?.segments]);

  const transcribeReady = serviceStatus.data?.transcriptionConfigured ?? true;
  const ended = meeting?.status === "ready" || meeting?.status === "failed";
  const processing = meeting?.status === "processing";
  const isUpload = meeting?.mode === "upload";
  const uploading = capture.uploadProgress !== null;
  const lastEnd = segments.reduce((max, s) => Math.max(max, s.endTime), 0);

  const startCapture = async (mode: "both" | "tab" | "mic" | "room") => {
    if (mode === "both" || mode === "tab") {
      toast.message("Pick the Meet tab and turn on “Also share tab audio”.", { duration: 6000 });
    }
    try {
      await capture.start({
        mic: mode !== "tab",
        tab: mode === "both" || mode === "tab",
        micSpeaker: mode === "room" ? "room" : "you",
        baseOffsetSec: lastEnd > 0 ? Math.ceil(lastEnd) + 1 : 0,
      });
      setLiveSince(Date.now() - lastEnd * 1000);
      setPanel("ask");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't start the transcript");
    }
  };

  const stopCapture = async () => {
    await capture.stop();
    setLiveSince(null);
    invalidate();
  };

  const endMeeting = async () => {
    if (capturing) await stopCapture();
    end.mutate({ id: meetingId });
  };

  const onFile = async (file: File) => {
    try {
      const result = await capture.processFile(file, lastEnd > 0 ? Math.ceil(lastEnd) + 1 : 0);
      capture.clearUploadProgress();
      if (result.aborted) return;
      if (result.failed > 0) toast.message(`${result.failed} of ${result.chunks} clips couldn't be transcribed.`);
      end.mutate({ id: meetingId });
    } catch (error) {
      capture.clearUploadProgress();
      toast.error(error instanceof Error && error.name === "EncodingError" ? "That file's audio couldn't be decoded." : "Couldn't process that recording.");
    }
  };

  const askFromNotes = (prompt: string) => {
    setPanel("ask");
    void agent.send(prompt);
  };

  const openMeet = () => {
    if (meeting?.meetUrl) window.open(meeting.meetUrl, "_blank", "noopener");
  };

  if (meetingQuery.isLoading) {
    return (
      <div className="thread-room-loading">
        <Loader2 size={18} className="thread-spin" />
      </div>
    );
  }
  if (meetingQuery.isError || !meeting) {
    return (
      <div className="thread-room-loading">
        <p>{meetingQuery.error?.message ?? "Meeting not found."}</p>
        <Link href="/apps/meet" className="thread-btn-accent">
          Back to meetings
        </Link>
      </div>
    );
  }

  const elapsed = liveSince ? (now - liveSince) / 1000 : meeting.durationSeconds;
  const silenceSkipped =
    capture.stats.heardSec > 5 ? Math.max(0, Math.round((1 - capture.stats.sentSec / capture.stats.heardSec) * 100)) : null;
  const notes = (meeting.notes as Notes | null) ?? null;
  const statusLabel = capturing
    ? "Live"
    : uploading
      ? "Transcribing upload"
      : processing
        ? "Transcribing"
        : meeting.status === "ready"
          ? "Ended"
          : meeting.status === "failed"
            ? "Failed"
            : meeting.status === "live"
              ? "Paused"
              : "Not started";

  const header: ReactNode = (
    <header className="thread-room-head">
      <Link href="/apps/meet" className="thread-room-icon-btn" title="All meetings">
        <ArrowLeft size={15} />
      </Link>
      <div className="thread-room-title">
        {editingTitle !== null ? (
          <input
            autoFocus
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onBlur={() => {
              const next = editingTitle.trim();
              setEditingTitle(null);
              if (next && next !== meeting.title) rename.mutate({ id: meetingId, title: next });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditingTitle(null);
            }}
            aria-label="Meeting title"
          />
        ) : (
          <button type="button" onClick={() => setEditingTitle(meeting.title ?? "")} title="Rename">
            {meeting.title || "Untitled meeting"}
          </button>
        )}
        <span className="thread-room-status" data-state={capturing ? "live" : meeting.status}>
          {capturing ? <span className="thread-room-rec-dot" aria-hidden /> : null}
          {statusLabel}
          {capturing || meeting.durationSeconds > 0 ? ` · ${clock(elapsed)}` : ""}
        </span>
      </div>

      <div className="thread-room-head-actions">
        <label className="thread-room-lang" title="Language people are speaking (Gnani)">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            disabled={capturing || uploading}
            aria-label="Meeting language"
          >
            {VOICE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
        {meeting.meetUrl ? (
          <button type="button" className="thread-room-btn" onClick={openMeet} title="Open the Google Meet call in a new tab">
            <ExternalLink size={13} /> Open Meet
          </button>
        ) : null}
        {pip.supported ? (
          <button
            type="button"
            className="thread-room-icon-btn"
            onClick={() => (pip.pipWindow ? pip.close() : void pip.open())}
            title={pip.pipWindow ? "Close floating window" : "Float over Meet (always on top)"}
            aria-pressed={Boolean(pip.pipWindow)}
          >
            <PictureInPicture2 size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="thread-room-icon-btn"
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </header>
  );

  const controlBar = (
    <div className="thread-room-controls">
      {!transcribeReady ? (
        <div className="thread-room-banner">Live transcription needs GNANI_API_KEY on the server.</div>
      ) : capturing ? (
        <>
          <div className="thread-room-meters">
            {capture.sources.tab ? (
              <span className="thread-room-meter" title="Meeting audio">
                <Video size={12} />
                <i style={{ transform: `scaleX(${Math.min(1, capture.levels.tab * 12)})` }} />
              </span>
            ) : null}
            {capture.sources.mic ? (
              <span className="thread-room-meter" title="Your mic">
                <Mic size={12} />
                <i style={{ transform: `scaleX(${Math.min(1, capture.levels.mic * 12)})` }} />
              </span>
            ) : null}
          </div>
          <span className="thread-room-efficiency" title="Silence and noise never leave your browser — only speech is sent to Gnani.">
            <Sparkles size={12} />
            {silenceSkipped !== null ? `${silenceSkipped}% silence skipped` : "Voice-gated"} · {capture.stats.chunks} clips
            {capture.stats.inFlight > 0 ? ` · ${capture.stats.inFlight} transcribing` : ""}
          </span>
          <button type="button" className="thread-room-btn" onClick={() => void stopCapture()} disabled={capture.state === "stopping"}>
            <Square size={12} /> Pause
          </button>
          <button type="button" className="thread-room-btn" data-variant="danger" onClick={() => void endMeeting()} disabled={end.isPending}>
            End meeting
          </button>
        </>
      ) : uploading ? (
        <div className="thread-room-progress">
          <span>
            Transcribing recording · {capture.uploadProgress?.done ?? 0} / {capture.uploadProgress?.total ?? 0} clips
          </span>
          <i
            style={{
              transform: `scaleX(${capture.uploadProgress && capture.uploadProgress.total ? capture.uploadProgress.done / capture.uploadProgress.total : 0})`,
            }}
          />
        </div>
      ) : processing ? (
        <div className="thread-room-banner">
          <Loader2 size={13} className="thread-spin" /> Gnani is transcribing the recording…
        </div>
      ) : ended ? (
        <>
          <span className="thread-room-ended">
            {meeting.status === "failed" ? meeting.errorMessage ?? "Transcription failed." : `${segments.length} lines · notes ready`}
          </span>
          {confirmDelete ? (
            <button type="button" className="thread-room-btn" data-variant="danger" onClick={() => remove.mutate({ id: meetingId })} disabled={remove.isPending}>
              Confirm delete
            </button>
          ) : (
            <button type="button" className="thread-room-icon-btn" onClick={() => setConfirmDelete(true)} title="Delete meeting">
              <Trash2 size={14} />
            </button>
          )}
        </>
      ) : (
        <>
          {isUpload && segments.length === 0 ? (
            <button type="button" className="thread-room-primary" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} /> Choose a recording
            </button>
          ) : (
            <CaptureMenu hasMeetLink={Boolean(meeting.meetUrl)} onStart={(mode) => void startCapture(mode)} />
          )}
          {!isUpload ? (
            <button type="button" className="thread-room-btn" onClick={() => fileInputRef.current?.click()} title="Transcribe a recording instead">
              <Upload size={13} /> Upload recording
            </button>
          ) : null}
          {segments.length > 0 ? (
            <button type="button" className="thread-room-btn" onClick={() => void endMeeting()} disabled={end.isPending}>
              End meeting
            </button>
          ) : null}
          <label className="thread-room-keep-audio" title="Keeps this meeting's audio for 48 hours so you can dub it after it ends. Off by default.">
            <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
            Save audio for dubbing
          </label>
          <span className="thread-room-hint">
            {voiceLanguageLabel(language).label} · silence is skipped in your browser, only speech goes to Gnani
          </span>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onFile(file);
        }}
      />
    </div>
  );

  return (
    <div className="thread-room" data-fullscreen={fullscreen ? "true" : undefined}>
      {header}
      {controlBar}
      <div className="thread-room-body">
        <section className="thread-room-pane thread-room-pane-transcript" aria-label="Transcript">
          <div className="thread-room-pane-head">
            Transcript
            <span>{segments.length ? `${segments.length} lines` : ""}</span>
          </div>
          <TranscriptView segments={segments} live={capturing} />
        </section>
        <section className="thread-room-pane thread-room-pane-side" aria-label="Thread">
          <div className="thread-room-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={panel === "ask"} data-active={panel === "ask" ? "true" : undefined} onClick={() => setPanel("ask")}>
              <Bot size={13} /> Ask Thread
            </button>
            <button type="button" role="tab" aria-selected={panel === "notes"} data-active={panel === "notes" ? "true" : undefined} onClick={() => setPanel("notes")}>
              <Sparkles size={13} /> Notes
              {notes?.actionItems.length ? <em>{notes.actionItems.length}</em> : null}
            </button>
            <button type="button" role="tab" aria-selected={panel === "dub"} data-active={panel === "dub" ? "true" : undefined} onClick={() => setPanel("dub")}>
              <Languages size={13} /> Dub
            </button>
          </div>
          {panel === "ask" ? (
            <AskPanel agent={agent} />
          ) : panel === "dub" ? (
            <MeetingDubPanel meetingId={meetingId} ended={meeting.status === "ready"} />
          ) : (
            <NotesPanel
              notes={notes}
              coveredLines={meeting.summarizedCount}
              totalLines={meeting.segmentCount}
              refreshing={refresh.isPending}
              onRefresh={() => refresh.mutate({ id: meetingId })}
              onAction={askFromNotes}
            />
          )}
        </section>
      </div>

      {pip.pipWindow
        ? createPortal(
            <div className="thread-pip">
              <div className="thread-pip-head">
                <span className="thread-room-status" data-state={capturing ? "live" : meeting.status}>
                  {capturing ? <span className="thread-room-rec-dot" aria-hidden /> : null}
                  {statusLabel} · {clock(elapsed)}
                </span>
                <strong>{meeting.title || "Meeting"}</strong>
              </div>
              <TranscriptView segments={segments} live={capturing} compact />
              <AskPanel agent={agent} compact />
            </div>,
            pip.pipWindow.document.body,
          )
        : null}
    </div>
  );
}
