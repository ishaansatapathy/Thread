"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bot, Calendar, CheckCircle2, Mail, Sparkles, Zap } from "lucide-react";
import { Reveal } from "./thread-reveal";

type Slide = {
  id: string;
  title: string;
  desc: string;
  back: ReactNode;
  front: ReactNode;
};

function Window({ title, children, accent = false }: { title: string; children: ReactNode; accent?: boolean }) {
  return (
    <div className="thread-show-window" data-accent={accent}>
      <div className="thread-show-window-head">
        <span className="thread-rotator-dot" />
        <span className="thread-rotator-dot" />
        <span style={{ marginLeft: 8, fontFamily: "var(--thread-mono)", fontSize: 10, color: "var(--thread-dim)" }}>
          {title}
        </span>
      </div>
      <div className="thread-show-window-body">{children}</div>
    </div>
  );
}

function SkelBar({ w, strong = false }: { w: string; strong?: boolean }) {
  return <span className="thread-skel-bar" style={{ width: w, opacity: strong ? 0.8 : undefined }} />;
}

const SLIDES: Slide[] = [
  {
    id: "webhook",
    title: "Mail lands, Thread already knows",
    desc: "Corsair webhooks push every change into Postgres the moment it happens — no polling, no refresh button.",
    back: (
      <Window title="corsair · events">
        <div className="thread-rotator-stack thread-rotator-stack--log">
          <div className="thread-rotator-log"><span>gmail.message.created</span><span className="thread-rotator-log-ok">200</span></div>
          <div className="thread-rotator-log"><span>gmail.thread.updated</span><span className="thread-rotator-log-ok">200</span></div>
          <div className="thread-rotator-log" style={{ opacity: 0.4 }}><span>calendar.event.updated</span><span>…</span></div>
        </div>
      </Window>
    ),
    front: (
      <Window title="thread · inbox" accent>
        <div className="thread-rotator-stack">
          <div className="thread-rotator-row" style={{ borderColor: "rgba(96,165,250,0.35)" }}>
            <Zap size={13} color="var(--thread-accent-bright)" style={{ flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <SkelBar w="62%" strong />
              <SkelBar w="38%" />
            </div>
            <span className="thread-rotator-chip thread-rotator-chip--hot">cached</span>
          </div>
          <div className="thread-rotator-row" style={{ opacity: 0.55 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <SkelBar w="54%" />
              <SkelBar w="32%" />
            </div>
          </div>
        </div>
      </Window>
    ),
  },
  {
    id: "rank",
    title: "AI ranks it, drafts wait for you",
    desc: "Every thread gets a priority score and a context-aware draft — queued, never auto-sent.",
    back: (
      <Window title="thread · scoring">
        <div className="thread-rotator-stack">
          <div className="thread-rotator-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <SkelBar w="66%" strong />
              <SkelBar w="42%" />
            </div>
            <span className="thread-rotator-chip thread-rotator-chip--hot">High</span>
          </div>
          <div className="thread-rotator-row" style={{ opacity: 0.6 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <SkelBar w="50%" />
              <SkelBar w="30%" />
            </div>
            <span className="thread-rotator-chip">Low</span>
          </div>
        </div>
      </Window>
    ),
    front: (
      <Window title="thread · ai" accent>
        <div className="thread-rotator-stack">
          {[
            { icon: Sparkles, label: "Rank priority" },
            { icon: Mail, label: "Draft reply" },
            { icon: Bot, label: "Summarize thread" },
          ].map((row, i) => (
            <div key={row.label} className="thread-hero-cmd-row" data-first={i === 0} style={{ border: "1px solid var(--thread-line-soft)", borderRadius: 9 }}>
              <span className="thread-hero-cmd-icon" style={{ width: 24, height: 24 }}>
                <row.icon size={12} />
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{row.label}</span>
              <span className="thread-rotator-chip" style={{ marginLeft: "auto" }}>AI</span>
            </div>
          ))}
        </div>
      </Window>
    ),
  },
  {
    id: "approve",
    title: "You approve, everything ships",
    desc: "One tap: the reply sends and the invite lands on Google Calendar. Human in the loop, always.",
    back: (
      <Window title="thread · queue">
        <div className="thread-rotator-stack">
          <div className="thread-rotator-row">
            <Mail size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <SkelBar w="58%" strong />
            </div>
            <span className="thread-rotator-chip">Draft</span>
          </div>
          <div className="thread-rotator-row">
            <Calendar size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <SkelBar w="44%" />
            </div>
            <span className="thread-rotator-chip">Invite</span>
          </div>
        </div>
      </Window>
    ),
    front: (
      <Window title="thread · done" accent>
        <div className="thread-rotator-stack">
          <div className="thread-show-done">
            <CheckCircle2 size={15} color="var(--thread-accent-bright)" />
            <span>Reply sent</span>
          </div>
          <div className="thread-show-done">
            <CheckCircle2 size={15} color="var(--thread-accent-bright)" />
            <span>Invite on calendar — Tue 10:00</span>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--thread-dim)", paddingTop: 4 }}>
            Approved once · executed via Corsair
          </p>
        </div>
      </Window>
    ),
  },
];

const SLIDE_MS = 4200;

export function ThreadShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setActive((p) => (p + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [paused]);

  const slide = SLIDES[active] ?? SLIDES[0]!;

  return (
    <section className="thread-shell thread-section">
      <div className="thread-frame" style={{ padding: "72px 32px" }}>
        <Reveal style={{ textAlign: "center", marginBottom: 40 }}>
          <span className="thread-eyebrow">Automation</span>
          <h2 className="thread-h2" style={{ marginTop: 16 }}>
            From webhook to sent — hands off
          </h2>
        </Reveal>

        <div
          className="thread-show-stage"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div key={`b-${active}`} className="thread-show-back">
            {slide.back}
          </div>
          <div key={`f-${active}`} className="thread-show-front">
            {slide.front}
          </div>
        </div>

        <div className="thread-show-caption" key={`c-${active}`}>
          <h3 style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" }}>{slide.title}</h3>
          <p style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.65, color: "var(--thread-muted)", maxWidth: 440, marginInline: "auto" }}>
            {slide.desc}
          </p>
        </div>

        <div className="thread-show-segments" role="tablist" aria-label="Automation steps">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              className="thread-show-segment"
              data-active={i === active}
              onClick={() => setActive(i)}
            >
              <span
                className="thread-show-segment-fill"
                data-active={i === active && !paused}
                style={{ animationDuration: `${SLIDE_MS}ms` }}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
