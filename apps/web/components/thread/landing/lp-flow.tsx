"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowUp,
  Calendar,
  FileText,
  Mic,
  MousePointer2,
  Plus,
  Presentation,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react";
import { clamp, scrollToProgress, useScrollProgress } from "./use-scroll-progress";

const STEPS = [
  {
    pill: "Ask",
    title: "Ask once, in any language",
    desc: "Type or speak a single request. “Kal 4 baje design sync rakho aur baaki sambhal lo” works just as well as English.",
    prompt: "Set up a design sync tomorrow 4pm and handle the rest",
  },
  {
    pill: "Meet",
    title: "A meeting, set up for you",
    desc: "Thread creates the Google Meet, finds the right people from recent threads and queues the invite for your approval.",
    prompt: "Invite everyone from the onboarding thread",
  },
  {
    pill: "Listen",
    title: "It listens while you talk",
    desc: "Live captions stream into Thread. Gnani transcribes Hindi, English and code-mixed speech without missing a beat.",
    prompt: "Take notes during the call",
  },
  {
    pill: "Extract",
    title: "Dates and decisions, captured",
    desc: "Every deadline lands on your calendar and the notes write themselves into a Google Doc, with action items assigned.",
    prompt: "Add the deadlines to my calendar",
  },
  {
    pill: "Present",
    title: "The deck is ready before you ask",
    desc: "Need to present the outcome? Thread drafts the Slides deck and the follow-up email, then waits for your go.",
    prompt: "Make a deck from this meeting",
  },
] as const;

type Node = {
  id: string;
  step: number;
  x: number;
  y: number;
  icon: LucideIcon;
  tag: string;
  title: string;
  body: ReactNode;
  foot: string;
  accent?: boolean;
};

const W = 760;
const H = 520;
const NW = 190;

const NODES: Node[] = [
  {
    id: "ask",
    step: 0,
    x: 16,
    y: 176,
    icon: Sparkles,
    tag: "You · 1 prompt",
    title: "Set up a design sync tomorrow 4pm and handle the rest",
    body: <p>Context: onboarding thread, 6 people</p>,
    foot: "Thread is on it",
  },
  {
    id: "meet",
    step: 1,
    x: 285,
    y: 34,
    icon: Video,
    tag: "Meet · created",
    title: "Design sync · Tue 16:00",
    body: <p className="lp-flow-mono">meet.google.com/xqk-raft-tpw</p>,
    foot: "Invite queued · 6 people",
  },
  {
    id: "listen",
    step: 2,
    x: 285,
    y: 270,
    icon: Mic,
    tag: "Live transcript · Gnani",
    title: "“Vendor deadline 28 tak final karna hai”",
    body: <p>Hindi + English · 42 min</p>,
    foot: "Listening",
    accent: true,
  },
  {
    id: "cal",
    step: 3,
    x: 554,
    y: 14,
    icon: Calendar,
    tag: "Calendar · 2 dates",
    title: "Deadlines added",
    body: (
      <ul>
        <li>Vendor deadline — 28 Oct</li>
        <li>Design review — Fri 11:00</li>
      </ul>
    ),
    foot: "Queued for approval",
  },
  {
    id: "doc",
    step: 3,
    x: 554,
    y: 190,
    icon: FileText,
    tag: "Docs · notes",
    title: "Design sync — notes",
    body: <p>4 decisions · 5 action items</p>,
    foot: "Shared with attendees",
  },
  {
    id: "slides",
    step: 4,
    x: 554,
    y: 366,
    icon: Presentation,
    tag: "Slides · 9 slides",
    title: "Onboarding v2 — review",
    body: <p>Speaker notes + follow-up email drafted</p>,
    foot: "Ready to present",
    accent: true,
  },
];

const NODE_H = 128;

type Edge = { from: string; to: string; step: number; count: number; vertical?: boolean };

const EDGES: Edge[] = [
  { from: "ask", to: "meet", step: 1, count: 1 },
  { from: "meet", to: "listen", step: 2, count: 1, vertical: true },
  { from: "listen", to: "cal", step: 3, count: 2 },
  { from: "listen", to: "doc", step: 3, count: 5 },
  { from: "listen", to: "slides", step: 4, count: 9 },
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));

function edgePath(e: Edge) {
  const a = byId[e.from]!;
  const b = byId[e.to]!;
  if (e.vertical) {
    const x = a.x + NW / 2;
    return { d: `M${x} ${a.y + NODE_H} L${x} ${b.y}`, mx: x, my: (a.y + NODE_H + b.y) / 2 };
  }
  const ax = a.x + NW;
  const ay = a.y + NODE_H / 2;
  const bx = b.x;
  const by = b.y + NODE_H / 2;
  const dx = (bx - ax) * 0.5;
  return {
    d: `M${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`,
    mx: (ax + bx) / 2,
    my: (ay + by) / 2,
  };
}

const RAIL: LucideIcon[] = [Plus, MousePointer2, Sparkles, FileText, Calendar];
const RAIL_W = 48;

export function LpFlow() {
  const [ref, progress] = useScrollProgress<HTMLElement>("sticky");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setScale(Math.min(1, ((entry?.contentRect.width ?? W) - RAIL_W) / W)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pos = progress * (STEPS.length + 0.2);
  const active = Math.min(STEPS.length - 1, Math.max(0, Math.floor(pos)));
  const step = STEPS[active]!;
  const typed = Math.floor(step.prompt.length * clamp((pos - active) * 2.4));
  const goTo = (i: number) => scrollToProgress(ref.current, (i + 0.45) / (STEPS.length + 0.2));

  return (
    <section ref={ref} id="how" className="lp-flow-section" style={{ height: `${100 + STEPS.length * 70}vh` }}>
      <div className="lp-flow-sticky">
        <div className="lp-flow-grid">
          <div className="lp-flow-copy">
            <span className="lp-eyebrow">One prompt, end to end</span>
            <div className="lp-flow-pills" role="tablist">
              {STEPS.map((s, i) => (
                <button
                  key={s.pill}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  data-active={i === active}
                  data-done={i < active}
                  onClick={() => goTo(i)}
                >
                  {s.pill}
                </button>
              ))}
            </div>

            <span className="lp-flow-count">0{active + 1} / 0{STEPS.length}</span>
            <h2 key={step.title} className="lp-flow-title">
              {step.title}
            </h2>
            <p key={step.desc} className="lp-flow-desc">
              {step.desc}
            </p>

            <div className="lp-flow-input">
              <span className="lp-flow-input-chip">
                <Sparkles size={11} /> Thread agent
              </span>
              <p>
                {step.prompt.slice(0, typed)}
                <i className="lp-caret" />
              </p>
              <div className="lp-flow-input-foot">
                <Mic size={14} />
                <span className="lp-flow-send">
                  <ArrowUp size={14} />
                </span>
              </div>
            </div>
          </div>

          <div className="lp-flow-window" ref={boxRef}>
            <div className="lp-flow-window-bar">
              <span>Thread canvas</span>
              <span className="lp-flow-window-meta">
                {NODES.filter((n) => pos >= n.step - 0.05).length} actions · 1 prompt
              </span>
            </div>
            <div className="lp-flow-window-body" style={{ height: H * scale }}>
              <div className="lp-flow-rail">
                {RAIL.map((Icon, i) => (
                  <span key={i} data-active={i === 0}>
                    <Icon size={13} />
                  </span>
                ))}
              </div>
              <div className="lp-flow-canvas" style={{ width: W, height: H, transform: `scale(${scale})` }}>
                <svg className="lp-flow-edges" viewBox={`0 0 ${W} ${H}`} aria-hidden>
                  {EDGES.map((e) => {
                    const { d, mx, my } = edgePath(e);
                    const frac = clamp((pos - (e.step - 0.55)) / 0.5);
                    return (
                      <g key={`${e.from}-${e.to}`} style={{ opacity: frac > 0 ? 1 : 0 }}>
                        <path d={d} pathLength={1} style={{ strokeDashoffset: 1 - frac }} />
                        <g className="lp-flow-badge" data-on={frac > 0.5}>
                          <circle cx={mx} cy={my} r={9} />
                          <text x={mx} y={my + 3.5}>
                            {e.count}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </svg>

                {NODES.map((node) => (
                  <div
                    key={node.id}
                    className="lp-flow-node"
                    data-on={pos >= node.step - 0.05}
                    data-accent={node.accent ?? false}
                    data-current={node.step === active}
                    style={{ left: node.x, top: node.y, width: NW, minHeight: NODE_H } as CSSProperties}
                  >
                    <span className="lp-flow-node-tag">
                      <node.icon size={11} />
                      {node.tag}
                    </span>
                    <p className="lp-flow-node-title">{node.title}</p>
                    <div className="lp-flow-node-body">{node.body}</div>
                    <span className="lp-flow-node-foot">▷ {node.foot}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
