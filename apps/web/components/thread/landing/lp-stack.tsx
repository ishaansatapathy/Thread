"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ClipboardList,
  FileText,
  GraduationCap,
  HardDrive,
  Mail,
  Presentation,
  Table,
  Video,
  type LucideIcon,
} from "lucide-react";
import { scrollToProgress, useScrollProgress } from "./use-scroll-progress";

type Note = {
  tag: string;
  title: string;
  rows?: string[];
  checks?: [string, boolean][];
  action?: [string, string];
};

type App = {
  id: string;
  app: string;
  icon: LucideIcon;
  hue: number;
  title: string;
  desc: string;
  chips: [string, string, string];
  notes: [Note, Note, Note, Note];
};

const APPS: App[] = [
  {
    id: "gmail",
    app: "Gmail",
    icon: Mail,
    hue: 221,
    title: "Clear your inbox in one prompt",
    desc: "Thread ranks every thread, drafts the replies that matter and parks them in your queue. Nothing sends until you approve.",
    chips: ["RANK", "DRAFT", "YOU APPROVE"],
    notes: [
      { tag: "Priority", title: "Needs you today", checks: [["Contract redlines — Priya", false], ["Offer letter — HR", false], ["Vendor invoice", true]] },
      { tag: "Smart reply", title: "3 suggestions", rows: ["Thanks — signing tonight.", "Can we push to Monday?"] },
      { tag: "Search", title: "from:priya has:attachment", rows: ["4 threads · 2 PDFs"] },
      { tag: "Queue", title: "Reply to Priya", action: ["Draft ready", "Approve"] },
    ],
  },
  {
    id: "calendar",
    app: "Calendar",
    icon: Calendar,
    hue: 212,
    title: "Your week, booked by asking",
    desc: "“Find 30 minutes with design next week.” Thread checks free/busy, proposes a slot and queues the invite.",
    chips: ["FREE / BUSY", "PROPOSE", "INVITE"],
    notes: [
      { tag: "Free slots", title: "Tue 10:00 · Wed 15:30", rows: ["All 4 attendees free"] },
      { tag: "Follow-ups", title: "From last week", checks: [["Vendor sync — no recap", false], ["Hiring loop — recap sent", true]] },
      { tag: "Recurring", title: "Weekly standup", rows: ["Mon–Fri · 10:00"] },
      { tag: "Queue", title: "Launch review", action: ["Thu · 16:00", "Approve"] },
    ],
  },
  {
    id: "meet",
    app: "Meet",
    icon: Video,
    hue: 248,
    title: "Meetings that take their own notes",
    desc: "Thread listens through live captions, understands Hinglish and Indian languages, and turns what was said into dates, tasks and follow-ups.",
    chips: ["LISTEN", "EXTRACT", "FOLLOW UP"],
    notes: [
      { tag: "Live captions", title: "“Thursday 4 baje rakhte hain”", rows: ["Hindi + English detected"] },
      { tag: "Extracted", title: "2 dates found", checks: [["Launch review — Thu 16:00", true], ["Vendor deadline — 28th", true]] },
      { tag: "Multilingual", title: "Powered by Gnani", rows: ["hi · ta · te · kn · bn · en"] },
      { tag: "Queue", title: "Add to Calendar", action: ["2 events", "Approve"] },
    ],
  },
  {
    id: "docs",
    app: "Docs",
    icon: FileText,
    hue: 226,
    title: "Docs that write themselves",
    desc: "Meeting notes, briefs and replies drafted straight into Google Docs — formatted, titled and shared with the right people.",
    chips: ["DRAFT", "FORMAT", "SHARE"],
    notes: [
      { tag: "Template", title: "Meeting notes", rows: ["Attendees · Decisions · Actions"] },
      { tag: "Action items", title: "4 assigned", checks: [["Revised deck — Arjun", false], ["Vendor call — You", false], ["Share brief — Priya", true]] },
      { tag: "Sharing", title: "design@team", rows: ["Can comment"] },
      { tag: "Queue", title: "Share ‘Sync notes’", action: ["4 people", "Approve"] },
    ],
  },
  {
    id: "sheets",
    app: "Sheets",
    icon: Table,
    hue: 199,
    title: "Spreadsheets that stay current",
    desc: "Numbers that arrive by email land in the right row. Ask a question about any sheet and get the answer, not the formula.",
    chips: ["READ", "APPEND", "ANSWER"],
    notes: [
      { tag: "Ask", title: "“Cloud spend in Q3?”", rows: ["₹4.2L · up 12% on Q2"] },
      { tag: "Auto-append", title: "From your inbox", checks: [["Invoice #2231 → row 48", true], ["Invoice #2232 → row 49", true]] },
      { tag: "Watching", title: "Budget tracker", rows: ["Updated 2 min ago"] },
      { tag: "Queue", title: "Update Q3 totals", action: ["3 cells", "Approve"] },
    ],
  },
  {
    id: "drive",
    app: "Drive",
    icon: HardDrive,
    hue: 234,
    title: "Find any file by describing it",
    desc: "“The vendor contract Priya sent last month” is enough. Thread searches, moves, copies and shares across Drive and shared drives.",
    chips: ["SEARCH", "ORGANISE", "SHARE"],
    notes: [
      { tag: "Found", title: "Vendor contract v3.pdf", rows: ["Shared by Priya · 12 Sep"] },
      { tag: "Organise", title: "Suggested", checks: [["14 invoices → Finance/Q3", false], ["Archive 2023 drafts", false]] },
      { tag: "Shared drive", title: "Design team", rows: ["212 files · 6 members"] },
      { tag: "Queue", title: "Share with legal", action: ["1 file", "Approve"] },
    ],
  },
  {
    id: "slides",
    app: "Slides",
    icon: Presentation,
    hue: 258,
    title: "Decks from a single sentence",
    desc: "Turn a meeting, a doc or a thread into a first-draft presentation — outline, layout and speaker notes included.",
    chips: ["OUTLINE", "DESIGN", "PRESENT"],
    notes: [
      { tag: "Source", title: "Monday product sync", rows: ["42 min transcript"] },
      { tag: "Outline", title: "12 slides", checks: [["Where we are", true], ["What shipped", true], ["Q3 bets", false]] },
      { tag: "Speaker notes", title: "Added to every slide", rows: ["Ready to present"] },
      { tag: "Queue", title: "Share ‘Q3 roadmap’", action: ["Leadership", "Approve"] },
    ],
  },
  {
    id: "forms",
    app: "Forms",
    icon: ClipboardList,
    hue: 240,
    title: "Forms built and read for you",
    desc: "Describe the form you need. Thread builds it, sends it, and summarises responses as they arrive.",
    chips: ["BUILD", "COLLECT", "SUMMARISE"],
    notes: [
      { tag: "Prompt", title: "“RSVP for Friday’s offsite”", rows: ["5 questions generated"] },
      { tag: "Summary", title: "Live", checks: [["72% attending", true], ["31 vegetarian", true]] },
      { tag: "Responses", title: "142 so far", rows: ["+18 in the last hour"] },
      { tag: "Queue", title: "Reminder email", action: ["40 people", "Approve"] },
    ],
  },
  {
    id: "classroom",
    app: "Classroom",
    icon: GraduationCap,
    hue: 205,
    title: "Classes that run on autopilot",
    desc: "Post assignments, track who has submitted and draft reminders — for teachers and students alike.",
    chips: ["POST", "TRACK", "REMIND"],
    notes: [
      { tag: "Course", title: "Physics · Grade 11", rows: ["32 students"] },
      { tag: "Missing work", title: "This week", checks: [["Unit 4 lab — 4 pending", false], ["Quiz 3 — all in", true]] },
      { tag: "Due soon", title: "Unit 4 · Monday", rows: ["28 of 32 submitted"] },
      { tag: "Queue", title: "Remind students", action: ["4 people", "Approve"] },
    ],
  },
];

const STAGE_W = 1100;
const STAGE_H = 620;
const NOTE_SLOTS = [
  { cls: "lt", anchor: [272, 128], to: [370, 210] },
  { cls: "lb", anchor: [288, 452], to: [370, 420] },
  { cls: "rt", anchor: [836, 116], to: [730, 196] },
  { cls: "rb", anchor: [820, 456], to: [730, 432] },
] as const;

function curve([ax, ay]: readonly number[], [bx, by]: readonly number[]) {
  const dx = (bx! - ax!) * 0.55;
  return `M${ax} ${ay} C ${ax! + dx} ${ay}, ${bx! - dx} ${by}, ${bx} ${by}`;
}

// Each card rests for part of its scroll window, then glides to the next.
function settle(pos: number) {
  const base = Math.floor(pos);
  const f = Math.min(1, Math.max(0, (pos - base - 0.18) / 0.64));
  return base + f * f * (3 - 2 * f);
}

function cardStyle(i: number, pos: number): CSSProperties {
  const d = i - pos;
  if (d <= -1 || d > 4) return { opacity: 0, visibility: "hidden" };
  if (d < 0) {
    const t = -d;
    return {
      transform: `translateY(${-t * 190}px) translateZ(${-t * 160}px) rotateX(${t * 28}deg) scale(${1 - t * 0.12})`,
      opacity: Math.min(1, Math.max(0, 1 - (t - 0.22) / 0.33)),
      zIndex: 60,
      "--content": Math.max(0, 1 - t * 4.5).toFixed(3),
    } as CSSProperties;
  }
  return {
    transform: `translateY(${-d * 24}px) translateZ(${-d * 50}px) scale(${1 - d * 0.06})`,
    opacity: Math.min(1, Math.max(0, 3.5 - d)),
    zIndex: Math.round(50 - d * 10),
    "--shade": Math.min(0.5, d * 0.17).toFixed(3),
  } as CSSProperties;
}

function NoteCard({ note }: { note: Note }) {
  return (
    <div className="lp-note">
      <span className="lp-note-tag">{note.tag}</span>
      <p className="lp-note-title">{note.title}</p>
      {note.rows?.map((r) => (
        <p key={r} className="lp-note-row">
          {r}
        </p>
      ))}
      {note.checks?.map(([label, done]) => (
        <p key={label} className="lp-note-check" data-done={done}>
          <i />
          {label}
        </p>
      ))}
      {note.action && (
        <div className="lp-note-action">
          <span>{note.action[0]}</span>
          <b>{note.action[1]}</b>
        </div>
      )}
    </div>
  );
}

export function LpStack() {
  const [ref, progress] = useScrollProgress<HTMLElement>("sticky");
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? STAGE_W;
      setMobile(w < 760);
      setScale(Math.min(1, w / STAGE_W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = APPS.length;
  const pos = settle(Math.min(n - 1, Math.max(0, (progress * 1.08 - 0.02) * (n - 1))));
  const active = Math.round(pos);
  const current = APPS[active] ?? APPS[0]!;
  const goTo = (i: number) => {
    const target = Math.min(n - 1, Math.max(0, i));
    scrollToProgress(ref.current, (target / (n - 1) + 0.02) / 1.08);
  };

  const stageStyle: CSSProperties = mobile
    ? {}
    : { width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` };

  return (
    <section ref={ref} className="lp-stack-section" style={{ height: `${100 + n * 60}vh` }}>
      <div className="lp-stack-sticky">
        <div className="lp-stack-head">
          <span className="lp-eyebrow">Nine apps · one assistant</span>
          <h2 className="lp-title lp-title--sm">
            Everything Google, <em>handled</em>
          </h2>
        </div>

        <div
          ref={frameRef}
          className="lp-stack-frame"
          data-mobile={mobile}
          style={mobile ? undefined : { height: STAGE_H * scale }}
        >
          <div className="lp-stack-stage" style={stageStyle}>
            {!mobile && (
              <svg className="lp-stack-lines" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} aria-hidden>
                {NOTE_SLOTS.map((s) => (
                  <g key={s.cls}>
                    <path d={curve(s.anchor, s.to)} />
                    <circle cx={s.to[0]} cy={s.to[1]} r={3} />
                    <circle cx={s.anchor[0]} cy={s.anchor[1]} r={2.5} />
                  </g>
                ))}
              </svg>
            )}

            {!mobile &&
              NOTE_SLOTS.map((s, i) => (
                <div key={`${current.id}-${s.cls}`} className={`lp-note-slot lp-note-slot--${s.cls}`}>
                  <NoteCard note={current.notes[i]!} />
                </div>
              ))}

            <div className="lp-stack-cards">
              {APPS.map((app, i) => (
                <article
                  key={app.id}
                  className="lp-stack-card"
                  style={{ ...cardStyle(i, pos), "--h": app.hue } as CSSProperties}
                  aria-hidden={i !== active}
                >
                  <div className="lp-stack-card-top">
                    <span className="lp-stack-card-icon">
                      <app.icon size={17} />
                    </span>
                    <span className="lp-stack-card-app">{app.app}</span>
                  </div>
                  <h3 className="lp-stack-card-title">{app.title}</h3>
                  <p className="lp-stack-card-desc">{app.desc}</p>
                  <div className="lp-stack-card-chips">
                    {app.chips.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        <div className="lp-stack-nav">
          <button
            type="button"
            aria-label="Previous app"
            onClick={() => goTo(active - 1)}
          >
            <ArrowLeft size={14} />
          </button>
          <div className="lp-stack-dots">
            {APPS.map((app, i) => (
              <button
                key={app.id}
                type="button"
                aria-label={app.app}
                data-active={i === active}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Next app"
            onClick={() => goTo(active + 1)}
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
