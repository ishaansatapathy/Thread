"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ThreadLogoMark, ThreadWordmark } from "./thread-logo";
import { ThreadAgentDemo } from "./thread-agent-demo";
import { GetStartedButton } from "./landing/lp-hero";

const FAQS = [
  {
    q: "What is Thread?",
    a: "Thread is an AI chief of staff for Google Workspace. It brings Gmail, Calendar, Drive, Docs, Sheets, Meet, Slides, Forms and Classroom into one place and acts on them from a single prompt.",
  },
  {
    q: "Will Thread ever send something without me?",
    a: "No. Every email, invite, file share and edit is staged in your approval queue first. You can auto-approve specific categories in settings, but the default is that nothing leaves without your sign-off.",
  },
  {
    q: "Which languages does Thread understand?",
    a: "English plus Hindi, Tamil, Telugu, Kannada, Bengali and code-mixed speech like Hinglish. Speech is transcribed with Gnani, so meetings and voice prompts work the way people actually talk.",
  },
  {
    q: "How does Thread handle my data?",
    a: "You connect with Google OAuth and can disconnect at any time. Tokens are encrypted at rest, and your mail and calendar metadata is cached only to make Thread fast. It is never sold or shared.",
  },
  {
    q: "Can I use Thread from Claude, Cursor or other AI tools?",
    a: "Yes. Thread exposes an MCP server with the same tools the in-app agent uses, so any MCP-compatible assistant can read your inbox, manage your calendar and queue actions for approval.",
  },
];

export function ThreadAgent() {
  return (
    <section id="agent" className="lp-section">
      <div className="lp-agent">
        <div className="lp-agent-head">
          <span className="lp-eyebrow">The agent</span>
          <h2 className="lp-title">
            Talk to your <em>whole</em> workspace
          </h2>
          <p className="lp-lede">
            57 tools across mail, calendar, files and meetings. Ask in plain language, watch it work, and
            approve the result.
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
    <section id="faq" className="lp-section">
      <div className="lp-faq">
        <div>
          <h2 className="lp-title">
            <em>questions</em>
          </h2>
        </div>

        <div className="lp-faq-list">
          {FAQS.map((faq, i) => (
            <div key={faq.q} className="lp-faq-item" data-open={open === i}>
              <button type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                {faq.q}
                <Plus size={16} />
              </button>
              <div className="lp-faq-answer">
                <div>
                  <p>{faq.a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ThreadCta() {
  return (
    <section id="get-started" className="lp-cta">
      <div className="lp-cta-glow" aria-hidden />
      <span className="lp-eyebrow">Get started</span>
      <h2 className="lp-cta-title">
        Hand Thread
        <br />
        the <em>busywork</em>
      </h2>
      <p className="lp-lede lp-center">
        Connect your Google account in under a minute. Thread starts with your inbox and grows into the rest.
      </p>
      <div className="lp-cta-actions">
        <GetStartedButton label="Get started free" />
      </div>
    </section>
  );
}

export function ThreadFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div className="lp-footer-brand">
          <ThreadLogoMark size={22} />
          <ThreadWordmark size="sm" />
        </div>
        <nav className="lp-footer-links" aria-label="Footer">
          <a href="#how">How it works</a>
          <a href="#workspace">Workspace</a>
          <a href="#agent">Agent</a>
          <a href="#faq">FAQ</a>
          <a href="/privacy">Privacy</a>
        </nav>
        <span className="lp-footer-copy">© {new Date().getFullYear()} Thread</span>
      </div>
    </footer>
  );
}
