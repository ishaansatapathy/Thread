"use client";

import { useState } from "react";
import {
  Calendar,
  ChevronDown,
  Github,
  ListChecks,
  Mail,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { ThreadLogoMark, ThreadWordmark } from "./thread-logo";
import { Reveal } from "./thread-reveal";
import { ThreadAgentDemo } from "./thread-agent-demo";

const MARQUEE = ["Gmail", "Google Calendar", "Corsair", "OpenAPI", "Webhooks", "Postgres", "Next.js", "OpenAI"];

const BENTO = [
  {
    title: "One-step invites",
    desc: "Turn any email into a calendar invite without leaving the thread.",
    visual: <Calendar size={18} color="#60a5fa" />,
  },
  {
    title: "AI priority inbox",
    desc: "OpenAI ranks subject + snippet so urgent mail surfaces first.",
    visual: <Sparkles size={18} color="var(--thread-accent-bright)" />,
  },
  {
    title: "Command palette",
    desc: "⌘K to jump anywhere — inbox search, queue, calendar, settings.",
    visual: (
      <div style={{ display: "flex", gap: 4 }}>
        <kbd style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid var(--thread-line)", fontSize: 10 }}>⌘</kbd>
        <kbd style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid var(--thread-line)", fontSize: 10 }}>K</kbd>
      </div>
    ),
  },
  {
    title: "Approval queue",
    desc: "Every reply, draft and invite waits in a queue you approve — nothing sends on its own.",
    visual: <ListChecks size={18} color="var(--thread-accent-bright)" />,
  },
  {
    title: "Webhook sync",
    desc: "A webhook receiver refreshes the local mail cache when Gmail changes.",
    visual: <Zap size={18} color="var(--thread-accent-bright)" />,
  },
  {
    title: "Local mail cache",
    desc: "Thread metadata in Postgres — faster reloads and fallback when Gmail is down.",
    visual: <Search size={18} color="var(--thread-accent-bright)" />,
  },
  {
    title: "Gmail search",
    desc: "Full Gmail query syntax (from:, subject:, has:attachment) with load-more paging.",
    visual: <Mail size={18} color="#f87171" />,
  },
  {
    title: "Calendar sync",
    desc: "Schedule, update and send invites through Corsair Calendar.",
    visual: <Calendar size={18} color="#60a5fa" />,
  },
];

const CAPABILITIES = [
  { title: "Read & search mail", desc: "Gmail query syntax with load-more paging; Postgres cache for reload speed." },
  { title: "Draft replies", desc: "Compose in Thread — every send and draft goes through the approval queue first." },
  { title: "Schedule from inbox", desc: "Pick a slot and queue a calendar invite without switching tabs." },
  { title: "Approve before send", desc: "Replies, drafts, invites, reschedules and deletes wait in Queue until you approve." },
];

const FAQS = [
  {
    q: "What is Thread?",
    a: "Thread is a Superhuman-style workflow app for Gmail and Google Calendar, powered by Corsair. You decide which actions are prominent — not Google.",
  },
  {
    q: "How does Thread use Corsair?",
    a: "Corsair handles Gmail and Calendar OAuth, the search and send APIs, and webhook delivery — Thread consumes those to read mail, queue actions, and keep its local cache fresh.",
  },
  {
    q: "Is this just a Gmail clone?",
    a: "No. Thread adds workflow improvements: one-step invites, AI priority, keyboard shortcuts, a human-approval queue, and a local metadata cache.",
  },
  {
    q: "What stack is Thread built on?",
    a: "Next.js, Postgres, and Corsair — as required by the hackathon.",
  },
];

export function ThreadMarquee() {
  const items = [...MARQUEE, ...MARQUEE];
  return (
    <div className="thread-shell thread-section">
      <div className="thread-frame thread-marquee">
        <div className="thread-marquee-track">
          {items.map((label, i) => (
            <span key={`${label}-${i}`} className="thread-marquee-item">
              <Sparkles size={13} style={{ opacity: 0.35 }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ThreadIntegrations() {
  return (
    <section id="integrations" className="thread-shell thread-section">
      <div className="thread-frame" style={{ padding: "72px 0 0" }}>
        <Reveal style={{ textAlign: "center", padding: "0 32px 48px" }}>
          <span className="thread-eyebrow">Integrations</span>
          <h2 className="thread-h2" style={{ marginTop: 16 }}>
            Plug Gmail &amp; Calendar into Thread
          </h2>
          <p className="thread-lede" style={{ maxWidth: 480, marginInline: "auto" }}>
            Corsair sits in the middle — OAuth, Gmail/Calendar APIs, webhooks, and OpenAPI for tools.
          </p>
        </Reveal>

        <div className="thread-hub">
          <div className="thread-hub-side">
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: "rgba(234,67,53,0.1)",
                  border: "1px solid rgba(234,67,53,0.2)",
                  display: "grid",
                  placeItems: "center",
                  margin: "0 auto 12px",
                }}
              >
                <Mail size={22} color="#f87171" />
              </div>
              <div style={{ fontWeight: 700 }}>Gmail</div>
              <div style={{ fontSize: 13, color: "var(--thread-muted)", marginTop: 4 }}>Search · Draft · Send</div>
            </div>
          </div>

          <div className="thread-hub-center">
            <div className="thread-hub-logo">
              <ThreadLogoMark size={88} />
            </div>
            <div style={{ marginTop: 12, textAlign: "center" }}>
              <ThreadWordmark size="md" />
              <div style={{ fontSize: 11, color: "var(--thread-dim)", marginTop: 6 }}>via Corsair</div>
            </div>
          </div>

          <div className="thread-hub-side">
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: "rgba(66,133,244,0.1)",
                  border: "1px solid rgba(66,133,244,0.2)",
                  display: "grid",
                  placeItems: "center",
                  margin: "0 auto 12px",
                }}
              >
                <Calendar size={22} color="#60a5fa" />
              </div>
              <div style={{ fontWeight: 700 }}>Google Calendar</div>
              <div style={{ fontSize: 13, color: "var(--thread-muted)", marginTop: 4 }}>Invite · Schedule</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ThreadWorkflows() {
  return (
    <section id="workflows" className="thread-shell thread-section">
      <div className="thread-frame">
        <div className="thread-bento">
          <div className="thread-bento-title">
            <span className="thread-eyebrow">Capabilities</span>
            <h2 className="thread-h2" style={{ marginTop: 14, fontSize: "clamp(1.5rem, 3vw, 2.1rem)" }}>
              Everything you need for email workflows
            </h2>
            <p className="thread-lede" style={{ maxWidth: 280 }}>
              Built for Gmail and Calendar — not generic cloud infra.
            </p>
          </div>

          {BENTO.map((cell) => (
            <div key={cell.title} className="thread-bento-cell">
              <div style={{ minHeight: 36, marginBottom: 14 }}>{cell.visual}</div>
              <h3 style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 8 }}>{cell.title}</h3>
              <p style={{ fontSize: 13, color: "var(--thread-muted)", lineHeight: 1.6 }}>{cell.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ThreadCapabilities() {
  return (
    <section className="thread-shell thread-section">
      <div className="thread-frame" style={{ padding: "72px 32px" }}>
        <Reveal>
          <span className="thread-eyebrow">What you can do</span>
          <h2 className="thread-h2" style={{ marginTop: 14, marginBottom: 12 }}>
            Built around real Gmail workflows
          </h2>
          <p className="thread-lede" style={{ maxWidth: 480, marginBottom: 36 }}>
            No demo inbox — connect your account and Thread works on your actual mail and calendar.
          </p>
        </Reveal>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 1, border: "1px solid var(--thread-line)", borderRadius: 12, overflow: "hidden" }}>
          {CAPABILITIES.map((item, i) => (
            <Reveal key={item.title} delay={i * 60}>
              <div
                style={{
                  padding: 22,
                  borderRight: i < CAPABILITIES.length - 1 ? "1px solid var(--thread-line)" : undefined,
                  background: "rgba(255,255,255,0.015)",
                }}
              >
                <h3 style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 8 }}>{item.title}</h3>
                <p style={{ fontSize: 13, color: "var(--thread-muted)", lineHeight: 1.6 }}>{item.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ThreadAgent() {
  return (
    <section id="agent" className="thread-shell thread-section">
      <div className="thread-frame" style={{ padding: "72px 32px" }}>
        <div style={{ marginBottom: 36, maxWidth: 520 }}>
          <div className="thread-badge" style={{ marginBottom: 16 }}>
            <span className="thread-eyebrow" style={{ letterSpacing: "0.1em" }}>Corsair MCP · Preview</span>
          </div>
          <h2 className="thread-h2">Talk to your inbox</h2>
          <p className="thread-lede" style={{ maxWidth: 420 }}>
            A preview of where Thread is heading: natural language → email + calendar actions over
            Corsair MCP. The animation below shows the intended flow.
          </p>
        </div>

        <ThreadAgentDemo />
      </div>
    </section>
  );
}

export function ThreadFaq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="thread-shell thread-section">
      <div className="thread-frame thread-faq-grid">
        <div>
          <span className="thread-eyebrow">Questions</span>
          <h2 className="thread-h2" style={{ marginTop: 14 }}>FAQ</h2>
          <p className="thread-lede">Questions about Thread &amp; the hackathon build.</p>
        </div>

        <div>
          {FAQS.map((faq, i) => (
            <div key={faq.q} style={{ borderTop: "1px solid var(--thread-line)" }}>
              <button
                type="button"
                onClick={() => setOpen(open === i ? -1 : i)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  padding: "18px 0",
                  textAlign: "left",
                  fontSize: 15,
                  color: open === i ? "var(--thread-text)" : "var(--thread-muted)",
                  fontWeight: open === i ? 600 : 400,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {faq.q}
                <ChevronDown size={16} style={{ transform: open === i ? "rotate(180deg)" : "none", transition: "transform 0.2s", opacity: 0.5 }} />
              </button>
              <div style={{ maxHeight: open === i ? 160 : 0, overflow: "hidden", transition: "max-height 0.25s ease" }}>
                <p style={{ paddingBottom: 18, fontSize: 14, lineHeight: 1.7, color: "var(--thread-muted)" }}>{faq.a}</p>
              </div>
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--thread-line)" }} />
        </div>
      </div>
    </section>
  );
}

export function ThreadCta() {
  return (
    <section id="get-started" className="thread-shell thread-section">
      <div className="thread-frame" style={{ padding: "80px 32px", textAlign: "center" }}>
        <div className="thread-cta-wrap" style={{ marginBottom: 0 }}>
          <video className="thread-mascot" src="/mascot.webm" autoPlay loop muted playsInline aria-hidden />
          <a href="/sign-in" className="thread-btn-primary">
            Get started free
          </a>
        </div>

        <p style={{ marginTop: 28, fontSize: 13, color: "var(--thread-dim)" }}>
          Free to try during the hackathon · your data stays in your Postgres + Google account
        </p>
      </div>
    </section>
  );
}

export function ThreadFooter() {
  return (
    <footer className="thread-shell">
      <div className="thread-frame thread-footer">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ThreadLogoMark size={22} />
          <ThreadWordmark size="sm" />
          <span style={{ color: "var(--thread-line)" }}>|</span>
          <Github size={14} style={{ opacity: 0.4 }} />
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <a href="#faq" style={{ color: "inherit", textDecoration: "none" }}>
            FAQ
          </a>
          <a href="#workflows" style={{ color: "inherit", textDecoration: "none" }}>
            Workflows
          </a>
          <span>#chaicode #corsair-dev</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--thread-dim)" }}>
          Early preview · hackathon build
        </div>
      </div>
    </footer>
  );
}
