"use client";

import { useState } from "react";
import { Bot, PenLine, Calendar, Search, Send } from "lucide-react";

const SUGGESTIONS = [
  { icon: PenLine, label: "Draft a reply to the latest thread" },
  { icon: Calendar, label: "Find a 30-min slot next week" },
  { icon: Search, label: "Search mail about the contract" },
];

const MCP_ACTIONS = [
  { name: "mcp.gmail.draft", state: "idle" },
  { name: "mcp.gmail.search", state: "idle" },
  { name: "mcp.calendar.findSlot", state: "idle" },
  { name: "mcp.calendar.createEvent", state: "idle" },
];

export default function AgentPage() {
  const [draft, setDraft] = useState("");

  return (
    <div className="thread-app-page">
      <div className="thread-agent-page">
        <div className="thread-agent-pane">
          <div className="thread-agent-pane-head">
            <Bot size={14} style={{ opacity: 0.7 }} />
            Thread agent
            <span className="thread-mono-tag" style={{ marginLeft: "auto" }}>
              Idle
            </span>
          </div>

          <div className="thread-agent-feed">
            <div className="thread-rotator-bubble" style={{ fontSize: 13 }}>
              <Bot size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
              <span>
                Connect Gmail and Calendar, then I can draft replies, rank urgency, and queue invites through Corsair
                MCP. I never send anything without your approval.
              </span>
            </div>

            <div>
              <p className="thread-mono-tag" style={{ marginBottom: 10 }}>
                Example prompts
              </p>
              <div className="thread-agent-suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s.label} type="button" onClick={() => setDraft(s.label)}>
                    <s.icon size={13} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="thread-agent-composer">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Connect Gmail to run commands…"
              disabled
            />
            <button type="button" className="thread-agent-send" disabled aria-label="Send">
              <Send size={16} />
            </button>
          </div>
        </div>

        <div className="thread-agent-pane">
          <div className="thread-agent-pane-head">MCP actions</div>
          <div className="thread-agent-log">
            {MCP_ACTIONS.map((a) => (
              <div key={a.name} className="thread-agent-log-row">
                <span>{a.name}</span>
                <span>{a.state}</span>
              </div>
            ))}
            <p style={{ fontSize: 11, color: "var(--thread-dim)", lineHeight: 1.6, marginTop: 6 }}>
              Tools stay idle until Gmail and Calendar are connected. Every action runs in the human-in-the-loop queue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
