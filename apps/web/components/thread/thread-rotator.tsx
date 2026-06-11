"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, Calendar, PenLine, Search, Sparkles, Zap } from "lucide-react";
import { Reveal } from "./thread-reveal";

type RotatorItem = {
  phrase: string;
  label: string;
  desc: string;
  icon: ReactNode;
  panel: ReactNode;
};

/** Abstract skeleton bar — UI shape without fake user data. */
function Bar({ w, strong = false }: { w: number | string; strong?: boolean }) {
  return (
    <span
      className="thread-skel-bar"
      style={{ width: w, opacity: strong ? 0.8 : undefined }}
    />
  );
}

function PanelRow({ chip, chipTone, children }: { chip?: string; chipTone?: "hot" | "cool"; children: ReactNode }) {
  return (
    <div className="thread-rotator-row">
      <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>{children}</div>
      {chip && <span className={`thread-rotator-chip thread-rotator-chip--${chipTone ?? "cool"}`}>{chip}</span>}
    </div>
  );
}

const ITEMS: RotatorItem[] = [
  {
    phrase: "Score your inbox.",
    label: "AI priority",
    desc: "An LLM ranks every thread so the urgent ones float to the top.",
    icon: <Sparkles size={13} />,
    panel: (
      <div className="thread-rotator-stack">
        <PanelRow chip="High" chipTone="hot">
          <Bar w="72%" strong />
          <Bar w="46%" />
        </PanelRow>
        <PanelRow chip="Medium">
          <Bar w="60%" strong />
          <Bar w="38%" />
        </PanelRow>
        <PanelRow chip="Low">
          <Bar w="52%" />
          <Bar w="30%" />
        </PanelRow>
      </div>
    ),
  },
  {
    phrase: "Draft replies.",
    label: "Draft assist",
    desc: "Context-aware drafts queued for review — nothing sends itself.",
    icon: <PenLine size={13} />,
    panel: (
      <div className="thread-rotator-stack">
        <div className="thread-rotator-compose">
          <Bar w="84%" strong />
          <Bar w="92%" />
          <Bar w="64%" />
        </div>
        <div className="thread-rotator-footrow">
          <span className="thread-rotator-chip thread-rotator-chip--cool">Draft ready</span>
          <span style={{ fontSize: 11, color: "var(--thread-dim)" }}>waiting for your approval</span>
        </div>
      </div>
    ),
  },
  {
    phrase: "Send one-step invites.",
    label: "Calendar",
    desc: "Turn any thread into an invite without leaving the inbox.",
    icon: <Calendar size={13} />,
    panel: (
      <div className="thread-rotator-stack">
        <div className="thread-rotator-invite">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={14} color="var(--thread-accent-bright)" />
            <span style={{ fontSize: 12, fontWeight: 600 }}>30 min · next week</span>
          </div>
          <Bar w="58%" />
          <div className="thread-rotator-footrow">
            <span className="thread-rotator-chip thread-rotator-chip--cool">Approve &amp; send</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    phrase: "Search cached mail.",
    label: "Local search",
    desc: "Postgres-cached threads answer in under a second.",
    icon: <Search size={13} />,
    panel: (
      <div className="thread-rotator-stack">
        <div className="thread-rotator-search">
          <Search size={12} style={{ opacity: 0.5 }} />
          <span style={{ fontFamily: "var(--thread-mono)", fontSize: 11 }}>from:client deadline</span>
        </div>
        <PanelRow chip="0.4s">
          <Bar w="68%" strong />
          <Bar w="42%" />
        </PanelRow>
        <PanelRow>
          <Bar w="56%" />
          <Bar w="34%" />
        </PanelRow>
      </div>
    ),
  },
  {
    phrase: "Talk to an agent.",
    label: "Corsair MCP",
    desc: "Plain-English commands that turn into email and calendar actions.",
    icon: <Bot size={13} />,
    panel: (
      <div className="thread-rotator-stack">
        <div className="thread-rotator-bubble thread-rotator-bubble--user">
          &ldquo;Reply to this and find a slot Tuesday&rdquo;
        </div>
        <div className="thread-rotator-bubble">
          <Bot size={12} style={{ opacity: 0.6 }} />
          <span>2 actions queued — review to send</span>
        </div>
      </div>
    ),
  },
  {
    phrase: "React in realtime.",
    label: "Webhooks",
    desc: "Corsair webhooks push changes instantly — no polling loops.",
    icon: <Zap size={13} />,
    panel: (
      <div className="thread-rotator-stack thread-rotator-stack--log">
        <div className="thread-rotator-log"><span>gmail.message.created</span><span className="thread-rotator-log-ok">cached</span></div>
        <div className="thread-rotator-log"><span>calendar.event.updated</span><span className="thread-rotator-log-ok">synced</span></div>
        <div className="thread-rotator-log" style={{ opacity: 0.45 }}><span>gmail.thread.updated</span><span>…</span></div>
      </div>
    ),
  },
];

const INTERVAL_MS = 2400;

export function ThreadRotator() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (paused) return;
    timer.current = setInterval(() => {
      setActive((prev) => (prev + 1) % ITEMS.length);
    }, INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused]);

  const item = ITEMS[active] ?? ITEMS[0]!;

  return (
    <section className="thread-shell thread-section">
      <div className="thread-frame thread-rotator" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="thread-rotator-copy">
          <h2 className="thread-h2" style={{ marginBottom: 22 }}>
            What else can Thread do?
          </h2>

          <p className="thread-rotator-phrases">
            {ITEMS.map((it, i) => (
              <button
                key={it.phrase}
                type="button"
                className="thread-rotator-phrase"
                data-active={i === active}
                onClick={() => setActive(i)}
              >
                {it.phrase}
              </button>
            ))}
            <span className="thread-rotator-phrase" data-active={false} style={{ cursor: "default" }}>
              And much, much more.
            </span>
          </p>

          <div className="thread-rotator-meta">
            <span className="thread-rotator-badge">
              {item.icon}
              {item.label}
            </span>
            <p style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6, color: "var(--thread-muted)", maxWidth: 300 }}>
              {item.desc}
            </p>
          </div>
        </div>

        <Reveal>
          <div className="thread-rotator-window">
            <div className="thread-rotator-window-chrome">
              <span className="thread-rotator-dot" />
              <span className="thread-rotator-dot" />
              <span className="thread-rotator-dot" />
              <span style={{ marginLeft: "auto", fontFamily: "var(--thread-mono)", fontSize: 10, color: "var(--thread-dim)" }}>
                example
              </span>
            </div>
            <div key={active} className="thread-rotator-panel">
              {item.panel}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
