"use client";

import { Bot } from "lucide-react";

export default function AgentPage() {
  return (
    <div className="thread-app-page">
      <div className="thread-agent-page">
        <div className="thread-agent-pane" style={{ maxWidth: 640, margin: "0 auto" }}>
          <div className="thread-agent-pane-head">
            <Bot size={14} style={{ opacity: 0.7 }} />
            Thread agent
            <span className="thread-mono-tag" style={{ marginLeft: "auto" }}>
              Coming soon
            </span>
          </div>

          <div className="thread-agent-feed">
            <div className="thread-rotator-bubble" style={{ fontSize: 13 }}>
              <Bot size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
              <span>
                The agent will draft replies, rank inbox priority, and queue calendar actions
                through Corsair MCP — always through the approval queue, never direct send.
              </span>
            </div>

            <div className="thread-inbox-banner" style={{ marginTop: 4 }}>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
                Agent commands ship after the core inbox → queue → calendar flow is demo-ready.
                Use <strong>Inbox</strong> and <strong>Queue</strong> for the human-in-the-loop
                workflow today.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
