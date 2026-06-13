"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Calendar,
  CheckCircle2,
  Loader2,
  Mail,
  PenLine,
  Search,
  SendHorizonal,
  Sparkles,
  ListChecks,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import type { RouterOutputs } from "@repo/trpc/client";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ActionCard = RouterOutputs["agent"]["chat"]["actions"][number];

const SUGGESTIONS = [
  {
    label: "Rank urgent mail",
    icon: Sparkles,
    prompt: "Rank my inbox by urgency and tell me what needs attention first.",
  },
  {
    label: "Draft sick leave email",
    icon: PenLine,
    prompt:
      "Send an email to my manager at manager@company.com saying I was sick on 29-30 May and need leave. Keep it professional and queue it for approval.",
  },
  {
    label: "Search contract emails",
    icon: Search,
    prompt: "Search my inbox for emails about contract deadline and summarize what you find.",
  },
  {
    label: "What's in my queue?",
    icon: ListChecks,
    prompt: "Show me everything pending in my approval queue.",
  },
  {
    label: "Schedule a meeting",
    icon: Calendar,
    prompt:
      "Queue a 30-minute calendar invite tomorrow at 3pm IST titled Team sync with guest@company.com. Queue for approval.",
  },
];

function actionIcon(kind: ActionCard["kind"]) {
  switch (kind) {
    case "email_queued":
      return Mail;
    case "calendar_queued":
      return Calendar;
    case "queue_list":
      return ListChecks;
    case "inbox_ranked":
      return Sparkles;
    default:
      return Search;
  }
}

function ActionPanel({ actions }: { actions: ActionCard[] }) {
  if (actions.length === 0) {
    return (
      <div className="thread-agent-pane">
        <div className="thread-agent-pane-head">
          <CheckCircle2 size={14} style={{ opacity: 0.55 }} />
          Actions
        </div>
        <div className="thread-agent-feed" style={{ justifyContent: "center" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--thread-muted)", lineHeight: 1.55, textAlign: "center" }}>
            Tool results and queued items appear here — drafts, sends, and calendar invites always go to{" "}
            <strong style={{ color: "var(--thread-text)" }}>Queue</strong> for your approval.
          </p>
        </div>
      </div>
    );
  }

  const latest = actions[actions.length - 1]!;
  const Icon = actionIcon(latest.kind);

  return (
    <div className="thread-agent-pane">
      <div className="thread-agent-pane-head">
        <Icon size={14} style={{ opacity: 0.7 }} />
        {latest.title}
        {latest.href ? (
          <Link href={latest.href} className="thread-mono-tag" style={{ marginLeft: "auto" }}>
            Open →
          </Link>
        ) : null}
      </div>
      <div className="thread-agent-feed">
        {latest.detail ? (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--thread-muted)" }}>{latest.detail}</p>
        ) : null}
        {latest.lines?.map((line) => (
          <div key={line} className="thread-agent-log-row" style={{ alignItems: "flex-start" }}>
            <span style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, color: "var(--thread-text)", fontFamily: "inherit", fontSize: 12.5 }}>
              {line}
            </span>
          </div>
        ))}
        {(latest.kind === "email_queued" || latest.kind === "calendar_queued") && (
          <div className="thread-inbox-banner" style={{ marginTop: 4 }}>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
              Nothing sends until you <strong>Approve</strong> in Queue.
            </p>
            <Link href="/queue" className="thread-inbox-loadmore" style={{ marginTop: 10, display: "inline-flex" }}>
              Review in Queue
            </Link>
          </div>
        )}
        {actions.length > 1 ? (
          <div className="thread-agent-log" style={{ padding: 0, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: "var(--thread-dim)", fontFamily: "var(--thread-mono)" }}>
              {actions.length} actions this turn
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AgentPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastActions, setLastActions] = useState<ActionCard[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);

  const status = trpc.agent.status.useQuery({});
  const ready = status.data?.ready === true;
  const utils = trpc.useUtils();

  const chat = trpc.agent.chat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setLastActions(data.actions);
      void utils.queue.pendingCount.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Agent request failed");
    },
  });

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chat.isPending]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || chat.isPending) return;
    if (!ready) {
      toast.message("Add OPENAI_API_KEY to enable Thread Agent.");
      return;
    }
    setInput("");
    setLastActions([]);
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    chat.mutate({
      message,
      history: messages.slice(-12),
    });
  };

  return (
    <div className="thread-app-page">
      <div className="thread-agent-page">
        <div className="thread-agent-pane">
          <div className="thread-agent-pane-head">
            <Bot size={14} style={{ opacity: 0.7 }} />
            Thread Agent
            <span className="thread-mono-tag" style={{ marginLeft: "auto" }}>
              {ready ? status.data?.model ?? "gpt-4o-mini" : "OpenAI required"}
            </span>
          </div>

          <div className="thread-agent-feed" ref={feedRef}>
            {messages.length === 0 ? (
              <div className="thread-rotator-bubble" style={{ fontSize: 13, maxWidth: "100%" }}>
                <Bot size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
                <span>
                  Ask in plain language — e.g. &quot;Send mail to hr@company.com that I was sick 29–30 May&quot;.
                  I&apos;ll draft and <strong>queue</strong> it; you approve in Queue before anything sends.
                </span>
              </div>
            ) : null}

            {messages.map((msg, i) => (
              <div
                key={`${msg.role}-${i}`}
                className="thread-rotator-bubble thread-agent-msg"
                data-user={msg.role === "user" ? "true" : undefined}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                {msg.role === "assistant" ? <Bot size={13} style={{ opacity: 0.55, flexShrink: 0 }} /> : null}
                <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
              </div>
            ))}

            {chat.isPending ? (
              <div className="thread-rotator-bubble thread-agent-msg" style={{ fontSize: 13 }}>
                <Loader2 size={13} className="thread-spin" />
                <span className="thread-agent-typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : null}

            {!chat.isPending && messages.length === 0 ? (
              <div className="thread-agent-suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s.label} type="button" onClick={() => send(s.prompt)} disabled={!ready}>
                    <s.icon size={13} />
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <form
            className="thread-agent-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ready ? "Ask Thread Agent…" : "Set OPENAI_API_KEY in .env"}
              disabled={!ready || chat.isPending}
              aria-label="Agent message"
            />
            <button type="submit" className="thread-agent-send" disabled={!ready || chat.isPending || !input.trim()} aria-label="Send">
              {chat.isPending ? <Loader2 size={16} className="thread-spin" /> : <SendHorizonal size={16} />}
            </button>
          </form>
        </div>

        <ActionPanel actions={lastActions} />
      </div>
    </div>
  );
}
