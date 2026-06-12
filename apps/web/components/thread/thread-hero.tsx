"use client";

import { useState } from "react";
import Image from "next/image";
import { Inbox, Mail, Calendar, ListChecks, Command, Send, Search, PenLine } from "lucide-react";
import { ThreadWordmark } from "./thread-logo";
import { InViewAnnotation } from "./thread-reveal";

type DockTab = {
  id: string;
  label: string;
  path: string;
  icon: typeof Inbox;
};

const DOCK: DockTab[] = [
  { id: "inbox", label: "Inbox", path: "/inbox", icon: Inbox },
  { id: "queue", label: "Queue", path: "/queue", icon: ListChecks },
  { id: "calendar", label: "Calendar", path: "/calendar", icon: Calendar },
  { id: "command", label: "Search", path: "/inbox?focus=search", icon: Command },
];

function InboxState() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", minHeight: 380 }}>
      <div className="thread-hero-pane-side" style={{ borderRight: "1px solid var(--thread-line)", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <Image src="/thread-logo.svg" alt="" width={20} height={20} />
          <ThreadWordmark size="sm" />
        </div>

        <div className="thread-empty-inbox">
          <Inbox size={20} style={{ opacity: 0.35 }} />
          <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--thread-muted)" }}>
            No threads yet
          </p>
          <p style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--thread-dim)" }}>
            Connect Gmail to sync your inbox here.
          </p>
        </div>
      </div>

      <div
        style={{
          padding: 22,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            border: "1px solid var(--thread-line)",
            display: "grid",
            placeItems: "center",
            color: "var(--thread-dim)",
          }}
        >
          <Mail size={20} />
        </div>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" }}>Inbox not connected</h3>
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: "var(--thread-muted)", maxWidth: 280 }}>
            Sign in with Google to pull Gmail and Calendar into Thread.
          </p>
        </div>
        <a href="#get-started" className="thread-btn-accent" style={{ fontSize: 12, padding: "8px 14px" }}>
          Connect Gmail
        </a>
      </div>
    </div>
  );
}

const COMMANDS = [
  { icon: PenLine, label: "Compose reply", hint: "Open inbox to reply" },
  { icon: Send, label: "Send invite", hint: "Queue a calendar invite" },
  { icon: Search, label: "Search mail", hint: "Gmail query syntax" },
  { icon: ListChecks, label: "Approval queue", hint: "Review pending actions" },
];

function CommandState() {
  return (
    <div style={{ minHeight: 380, padding: "26px 28px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="thread-hero-cmd-input">
        <Search size={13} style={{ opacity: 0.45 }} />
        <span style={{ color: "var(--thread-dim)" }}>Search for commands…</span>
        <span className="thread-hero-kbd-group">
          <kbd className="thread-hero-kbd">⌘</kbd>
          <kbd className="thread-hero-kbd">K</kbd>
        </span>
      </div>

      <div className="thread-mono-tag" style={{ padding: "16px 4px 8px" }}>Suggestions</div>
      {COMMANDS.map((cmd, i) => (
        <div key={cmd.label} className="thread-hero-cmd-row" data-first={i === 0}>
          <span className="thread-hero-cmd-icon">
            <cmd.icon size={14} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{cmd.label}</span>
          <span style={{ fontSize: 12, color: "var(--thread-dim)" }}>{cmd.hint}</span>
          <span className="thread-rotator-chip" style={{ marginLeft: "auto" }}>Command</span>
        </div>
      ))}

      <p style={{ marginTop: "auto", fontSize: 11, color: "var(--thread-dim)", textAlign: "center" }}>
        Keyboard-first — every action reachable without the mouse
      </p>
    </div>
  );
}

function CalendarState() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return (
    <div style={{ minHeight: 380, padding: "26px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {days.map((d, i) => (
          <div key={d} className="thread-hero-day" data-active={i === 1}>
            <span style={{ fontFamily: "var(--thread-mono)", fontSize: 10, letterSpacing: "0.08em" }}>{d}</span>
            <div className="thread-hero-day-slot" data-active={i === 1} />
          </div>
        ))}
      </div>

      <div className="thread-rotator-invite" style={{ maxWidth: 360, marginInline: "auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Calendar size={14} color="var(--thread-accent-bright)" />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Invite queue</span>
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--thread-muted)" }}>
          Nothing queued yet. Once connected, replies and invites wait here for one-tap approval.
        </p>
      </div>

      <p style={{ marginTop: "auto", fontSize: 11, color: "var(--thread-dim)", textAlign: "center" }}>
        Google Calendar via Corsair — schedule without switching tabs
      </p>
    </div>
  );
}

const STATES: Record<string, () => React.ReactNode> = {
  inbox: InboxState,
  command: CommandState,
  calendar: CalendarState,
  queue: CommandState,
};

export function ThreadHero() {
  const [tab, setTab] = useState("inbox");
  const activeTab = DOCK.find((d) => d.id === tab) ?? DOCK[0]!;
  const StateView = STATES[tab] ?? InboxState;

  return (
    <section className="thread-hero">
      <div className="thread-grid-bg" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

      <div className="thread-shell thread-section">
        <div className="thread-frame">
          <div className="thread-hero-body thread-fade-up">
            <h1 className="thread-headline" data-hero-font="minecraft">
              Work at the
              <br />
              <span className="thread-headline-accent">speed of thought.</span>
            </h1>

            <p
              style={{
                marginTop: 22,
                maxWidth: 520,
                marginInline: "auto",
                fontSize: "1.05rem",
                lineHeight: 1.75,
                color: "var(--thread-muted)",
              }}
            >
              Thread is your command center for email and calendar — rank what matters, draft in seconds, and send only when{" "}
              <strong style={{ color: "var(--thread-text)", fontWeight: 600 }}>
                <InViewAnnotation type="underline" delay={600} strokeWidth={2}>
                  you
                </InViewAnnotation>
              </strong>{" "}
              say go.
            </p>

            <div style={{ marginTop: 40, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <div className="thread-cta-wrap">
                <video
                  className="thread-mascot"
                  src="/mascot.webm"
                  autoPlay
                  loop
                  muted
                  playsInline
                  aria-hidden
                />
                <a href="#get-started" className="thread-btn-primary">
                  Connect Gmail
                </a>
              </div>
              <a href="#how" className="thread-btn-ghost">
                How it works
              </a>
            </div>

            <p style={{ marginTop: 28, fontSize: 12, color: "var(--thread-dim)" }}>
              Gmail · Google Calendar · Corsair · Postgres
            </p>
          </div>

          <div id="preview" className="thread-preview-window">
            <div className="thread-preview-chrome">
              <div style={{ display: "flex", gap: 6 }}>
                {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                  <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.8 }} />
                ))}
              </div>
              <div
                style={{
                  flex: 1,
                  maxWidth: 300,
                  marginInline: "auto",
                  height: 24,
                  borderRadius: 5,
                  border: "1px solid var(--thread-line)",
                  background: "rgba(255,255,255,0.03)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0 10px",
                  fontFamily: "var(--thread-mono)",
                  fontSize: 11,
                  color: "var(--thread-dim)",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--thread-dim)" }} />
                {activeTab.path}
              </div>
            </div>

            <div key={tab} className="thread-hero-state">
              <StateView />
            </div>
          </div>

          <div className="thread-hero-dock" role="tablist" aria-label="Preview tabs">
            {DOCK.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={tab === d.id}
                className="thread-hero-dock-btn"
                data-active={tab === d.id}
                onClick={() => setTab(d.id)}
              >
                {tab === d.id && <span className="thread-hero-dock-tip">{d.label}</span>}
                <d.icon size={17} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
