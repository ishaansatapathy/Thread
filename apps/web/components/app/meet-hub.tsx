"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Link2, Loader2, Mic, Puzzle, Sparkles, Upload, Users, Video } from "lucide-react";

import { trpc } from "~/trpc/client";
import { useVoiceLanguage, voiceLanguageLabel } from "~/lib/voice/languages";

function clock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Not started",
  live: "Live",
  processing: "Transcribing",
  ready: "Notes ready",
  failed: "Failed",
};

/**
 * Meetings home: start a Meet with Thread listening, join one by link, capture an
 * in-person meeting, or transcribe a recording — then everything lands in a meeting room.
 */
export function MeetHub({ meetConnected, connectHref }: { meetConnected: boolean; connectHref: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [language] = useVoiceLanguage();
  const [title, setTitle] = useState("");
  const [joinLink, setJoinLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const status = trpc.meetings.status.useQuery({}, { staleTime: 60_000 });
  const meetings = trpc.meetings.list.useQuery({ limit: 30 }, { refetchInterval: 15_000 });
  const create = trpc.meetings.create.useMutation();

  const go = async (
    kind: string,
    input: { mode: "live" | "upload"; createMeetLink?: boolean; meetUrl?: string },
  ) => {
    // Open the Meet tab inside the click gesture so pop-up blockers allow it.
    const meetTab = input.createMeetLink || input.meetUrl ? window.open("about:blank", "_blank") : null;
    setBusy(kind);
    try {
      const meeting = await create.mutateAsync({
        title: title.trim() || undefined,
        languageCode: language,
        mode: input.mode,
        meetUrl: input.meetUrl,
        createMeetLink: input.createMeetLink,
      });
      if (meetTab) {
        if (meeting.meetUrl) {
          meetTab.opener = null;
          meetTab.location.href = meeting.meetUrl;
        } else {
          meetTab.close();
        }
      }
      void utils.meetings.list.invalidate();
      router.push(`/meet/${meeting.id}`);
    } catch (error) {
      meetTab?.close();
      toast.error(error instanceof Error ? error.message : "Couldn't create the meeting");
      setBusy(null);
    }
  };

  const validJoin = /^https:\/\/meet\.google\.com\/[a-z0-9-]+/i.test(joinLink.trim());
  const transcriptionReady = status.data?.transcriptionConfigured ?? true;

  return (
    <div className="thread-meethub">
      {!transcriptionReady ? (
        <div className="thread-room-banner">Live transcription needs GNANI_API_KEY on the server — rooms still work for notes and the agent.</div>
      ) : null}

      <Link href="/connect-extension" className="thread-meethub-ext">
        <Puzzle size={18} />
        <span>
          <strong>Use Thread inside Google Meet.</strong> The Chrome extension puts captions, notes and the agent in a side
          panel next to your call — no tab switching, no screen-share prompt.
        </span>
        <ArrowRight size={15} />
      </Link>

      <div className="thread-meethub-start">
        <input
          className="thread-meethub-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting title (optional) — e.g. Weekly sync, DBMS lecture 7"
          maxLength={200}
          aria-label="Meeting title"
        />
        <div className="thread-meethub-cards">
          {meetConnected ? (
            <button
              type="button"
              className="thread-meethub-card"
              data-primary="true"
              disabled={busy !== null}
              onClick={() => void go("new", { mode: "live", createMeetLink: true })}
            >
              <span className="thread-meethub-card-icon">
                {busy === "new" ? <Loader2 size={18} className="thread-spin" /> : <Video size={18} />}
              </span>
              <strong>New meeting</strong>
              <small>Creates a Meet link, opens it, and Thread listens in.</small>
            </button>
          ) : (
            <div className="thread-meethub-card" data-primary="true" data-static="true">
              <span className="thread-meethub-card-icon">
                <Video size={18} />
              </span>
              <strong>New meeting</strong>
              <small>Connect Google Meet to create links from Thread.</small>
              <a href={connectHref} className="thread-meethub-connect">
                Connect Meet
              </a>
            </div>
          )}

          <div className="thread-meethub-card" data-static="true">
            <span className="thread-meethub-card-icon">
              <Link2 size={18} />
            </span>
            <strong>Join with a link</strong>
            <form
              className="thread-meethub-join"
              onSubmit={(e) => {
                e.preventDefault();
                if (validJoin) void go("join", { mode: "live", meetUrl: joinLink.trim() });
              }}
            >
              <input
                value={joinLink}
                onChange={(e) => setJoinLink(e.target.value)}
                placeholder="meet.google.com/abc-defg-hij"
                aria-label="Google Meet link"
                onBlur={() => {
                  const v = joinLink.trim();
                  if (v && !v.startsWith("http")) setJoinLink(`https://${v}`);
                }}
              />
              <button type="submit" disabled={!validJoin || busy !== null} aria-label="Join">
                {busy === "join" ? <Loader2 size={14} className="thread-spin" /> : <ArrowRight size={14} />}
              </button>
            </form>
          </div>

          <button type="button" className="thread-meethub-card" disabled={busy !== null} onClick={() => void go("room", { mode: "live" })}>
            <span className="thread-meethub-card-icon">
              {busy === "room" ? <Loader2 size={18} className="thread-spin" /> : <Users size={18} />}
            </span>
            <strong>In-person or other app</strong>
            <small>Class, interview, Zoom on another device — Thread listens through your mic.</small>
          </button>

          <button type="button" className="thread-meethub-card" disabled={busy !== null} onClick={() => void go("upload", { mode: "upload" })}>
            <span className="thread-meethub-card-icon">
              {busy === "upload" ? <Loader2 size={18} className="thread-spin" /> : <Upload size={18} />}
            </span>
            <strong>Transcribe a recording</strong>
            <small>Audio or video of any length. Silence is skipped before it reaches Gnani.</small>
          </button>
        </div>
        <p className="thread-meethub-foot">
          <Mic size={12} /> Speaking {voiceLanguageLabel(language).label} · change it with the mic&apos;s language picker. Transcribed by Gnani;
          notes and actions by Thread.
        </p>
      </div>

      <section className="thread-appx-panel">
        <div className="thread-appx-panel-head">
          <h3>Thread meetings</h3>
        </div>
        {meetings.isLoading ? (
          <div className="thread-appx-empty">
            <Loader2 size={16} className="thread-spin" />
          </div>
        ) : meetings.isError ? (
          <div className="thread-appx-empty">{meetings.error.message}</div>
        ) : !meetings.data?.meetings.length ? (
          <div className="thread-appx-empty">No meetings yet. Start one above — Thread will transcribe it and keep notes.</div>
        ) : (
          <ul className="thread-appx-list">
            {meetings.data.meetings.map((m) => (
              <li key={m.id} className="thread-appx-row thread-meethub-row">
                <Link href={`/meet/${m.id}`} className="thread-appx-row-open">
                  <span className="thread-appx-row-icon" data-live={m.status === "live" ? "true" : undefined}>
                    {m.mode === "upload" ? <Upload size={14} /> : m.meetUrl ? <Video size={14} /> : <Users size={14} />}
                  </span>
                  <span className="thread-appx-row-name">
                    {m.title || "Untitled meeting"}
                    {m.summary ? <small>{m.summary}</small> : null}
                  </span>
                </Link>
                <span className="thread-appx-row-meta">
                  <span className="thread-meethub-status" data-state={m.status}>
                    {STATUS_LABEL[m.status] ?? m.status}
                  </span>{" "}
                  {m.durationSeconds > 0 ? `${clock(m.durationSeconds)} · ` : ""}
                  {when(m.createdAt)}
                </span>
                <span className="thread-appx-row-actions">
                  <Link
                    href={`/agent?prompt=${encodeURIComponent(`Using my meeting "${m.title || "Untitled meeting"}" (meetingId ${m.id}), `)}`}
                    className="thread-appx-iconbtn"
                    title="Ask Agent about this meeting"
                  >
                    <Sparkles size={13} />
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
