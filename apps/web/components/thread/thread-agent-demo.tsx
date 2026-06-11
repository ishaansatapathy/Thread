"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bot, Calendar, PenLine, Search, CheckCircle2 } from "lucide-react";

type Scenario = {
  id: string;
  chip: string;
  icon: typeof Bot;
  prompt: string;
  reply: string;
  effectTitle: string;
  effect: ReactNode;
};

function SkelBar({ w, strong = false }: { w: string; strong?: boolean }) {
  return <span className="thread-skel-bar" style={{ width: w, opacity: strong ? 0.8 : undefined }} />;
}

const SCENARIOS: Scenario[] = [
  {
    id: "draft",
    chip: "Draft a reply",
    icon: PenLine,
    prompt: "@Thread draft a reply to the latest thread",
    reply: "Draft ready — queued for your approval. Nothing sends without you.",
    effectTitle: "Inbox · draft queued",
    effect: (
      <div className="thread-rotator-stack">
        <div className="thread-rotator-row" style={{ borderColor: "rgba(96,165,250,0.35)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
            <SkelBar w="64%" strong />
            <SkelBar w="40%" />
          </div>
          <span className="thread-rotator-chip thread-rotator-chip--hot">Draft</span>
        </div>
        <div className="thread-rotator-row" style={{ opacity: 0.5 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
            <SkelBar w="56%" />
            <SkelBar w="34%" />
          </div>
        </div>
        <div className="thread-agent-effect-note">
          <CheckCircle2 size={12} />
          Review &amp; send from the queue
        </div>
      </div>
    ),
  },
  {
    id: "schedule",
    chip: "Schedule invite",
    icon: Calendar,
    prompt: "@Thread find a 30-min slot next week and send an invite",
    reply: "Proposed Tue 10:00 — invite queued for approval.",
    effectTitle: "Calendar · slot proposed",
    effect: (
      <div className="thread-rotator-stack">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => (
            <div key={d} className="thread-hero-day" data-active={i === 1} style={{ padding: "9px 4px" }}>
              <span style={{ fontFamily: "var(--thread-mono)", fontSize: 9, letterSpacing: "0.08em" }}>{d}</span>
              <div className="thread-hero-day-slot" data-active={i === 1} style={{ height: 18 }} />
            </div>
          ))}
        </div>
        <div className="thread-rotator-invite" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={13} color="var(--thread-accent-bright)" />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Tue · 10:00 — 10:30</span>
            <span className="thread-rotator-chip thread-rotator-chip--hot" style={{ marginLeft: "auto" }}>Queued</span>
          </div>
        </div>
        <div className="thread-agent-effect-note">
          <CheckCircle2 size={12} />
          Approve once — invite ships to Google Calendar
        </div>
      </div>
    ),
  },
  {
    id: "search",
    chip: "Search mail",
    icon: Search,
    prompt: "@Thread find emails about the contract deadline",
    reply: "3 matches from the local cache in 0.4s.",
    effectTitle: "Search · local cache",
    effect: (
      <div className="thread-rotator-stack">
        <div className="thread-rotator-search">
          <Search size={12} style={{ opacity: 0.5 }} />
          <span style={{ fontFamily: "var(--thread-mono)", fontSize: 11 }}>contract deadline</span>
          <span className="thread-rotator-chip thread-rotator-chip--hot" style={{ marginLeft: "auto" }}>0.4s</span>
        </div>
        {["68%", "57%", "61%"].map((w, i) => (
          <div key={w} className="thread-rotator-row" style={{ opacity: 1 - i * 0.22 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <SkelBar w={w} strong={i === 0} />
              <SkelBar w="36%" />
            </div>
          </div>
        ))}
      </div>
    ),
  },
];

export function ThreadAgentDemo() {
  const [active, setActive] = useState(0);
  const [stage, setStage] = useState(0); // 0 = prompt, 1 = thinking, 2 = reply + effect

  useEffect(() => {
    setStage(0);
    const t1 = setTimeout(() => setStage(1), 500);
    const t2 = setTimeout(() => setStage(2), 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [active]);

  const scenario = SCENARIOS[active] ?? SCENARIOS[0]!;

  return (
    <div className="thread-agent-demo">
      <div className="thread-agent-chips" role="tablist" aria-label="Agent scenarios">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            className="thread-agent-chip"
            data-active={i === active}
            onClick={() => setActive(i)}
          >
            <s.icon size={13} />
            {s.chip}
          </button>
        ))}
        <span className="thread-mono-tag" style={{ marginLeft: "auto", alignSelf: "center" }}>
          Example interaction
        </span>
      </div>

      <div className="thread-agent-grid">
        <div className="thread-agent-chat">
          <div className="thread-agent-chat-head">
            <Bot size={13} style={{ opacity: 0.6 }} />
            <span>Thread agent</span>
          </div>

          <div className="thread-agent-chat-body">
            <div key={`p-${active}`} className="thread-rotator-bubble thread-rotator-bubble--user thread-agent-msg">
              {scenario.prompt}
            </div>

            {stage === 1 && (
              <div className="thread-rotator-bubble thread-agent-msg" aria-label="Agent typing">
                <span className="thread-agent-typing">
                  <i /><i /><i />
                </span>
              </div>
            )}

            {stage === 2 && (
              <div key={`r-${active}`} className="thread-rotator-bubble thread-agent-msg" style={{ maxWidth: "92%" }}>
                <Bot size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
                <span>{scenario.reply}</span>
              </div>
            )}
          </div>

          <div className="thread-agent-input">
            <span style={{ color: "var(--thread-dim)" }}>Reply…</span>
            <span className="thread-hero-kbd" style={{ marginLeft: "auto" }}>↵</span>
          </div>
        </div>

        <div className="thread-agent-effect" data-live={stage === 2}>
          <div className="thread-agent-effect-head">
            <span className="thread-agent-effect-dot" data-live={stage === 2} />
            {scenario.effectTitle}
          </div>
          <div key={`e-${active}-${stage === 2}`} className={stage === 2 ? "thread-agent-effect-body thread-agent-effect-body--in" : "thread-agent-effect-body"}>
            {stage === 2 ? (
              scenario.effect
            ) : (
              <div className="thread-agent-effect-wait">
                <span className="thread-agent-typing"><i /><i /><i /></span>
                waiting for agent…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
