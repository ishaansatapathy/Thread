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
  Sparkles,
  ListChecks,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import type { RouterOutputs } from "@repo/trpc/client";
import { AgentMentionInput } from "~/components/app/agent-mention-input";

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

function agentWelcomeCopy(opts: {
  agentAutoApprove: boolean;
  calendarAutoApprove: boolean;
  settingsReady: boolean;
}) {
  if (!opts.settingsReady) {
    return "Ask in plain language — e.g. send mail, rank inbox, or schedule a meeting. Loading your approval settings…";
  }

  if (opts.agentAutoApprove) {
    return (
      <>
        Ask in plain language — e.g. &quot;Email hr@company.com that I was sick 29–30 May&quot;.
        <strong> Auto-approve is on</strong> for agent emails: I&apos;ll send via Gmail right away.
        {opts.calendarAutoApprove ? " Calendar invites also send immediately." : " Calendar invites still go to Queue first."}
      </>
    );
  }

  return (
    <>
      Ask in plain language — e.g. &quot;Draft an email to hr@company.com about sick leave 29–30 May&quot;.
      <strong> Queue first</strong> is on for agent emails: I&apos;ll draft and add to{" "}
      <strong>Queue</strong> — nothing sends until you approve.
    </>
  );
}

function ActionPanel({
  actions,
  agentAutoApprove,
}: {
  actions: ActionCard[];
  agentAutoApprove: boolean;
}) {
  if (actions.length === 0) {
    return (
      <div className="thread-agent-pane">
        <div className="thread-agent-pane-head">
          <CheckCircle2 size={14} style={{ opacity: 0.55 }} />
          Actions
        </div>
        <div className="thread-agent-feed" style={{ justifyContent: "center" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--thread-muted)", lineHeight: 1.55, textAlign: "center" }}>
            {agentAutoApprove ? (
              <>
                Agent emails and calendar actions can run immediately when{" "}
                <strong style={{ color: "var(--thread-text)" }}>Auto-approve</strong> is on in Settings.
              </>
            ) : (
              <>
                Drafts, sends, and calendar invites go to{" "}
                <strong style={{ color: "var(--thread-text)" }}>Queue</strong> for your approval first.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  const latest = actions.find((a) => a.kind === "inbox_ranked" || a.kind === "inbox_search") ?? actions[actions.length - 1]!;
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
        {(latest.kind === "email_queued" || latest.kind === "calendar_queued") &&
        latest.disposition === "queued" ? (
          <div className="thread-inbox-banner" style={{ marginTop: 4 }}>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
              Waiting in Queue — <strong>Approve</strong> before it sends.
            </p>
            <Link href="/queue" className="thread-inbox-loadmore" style={{ marginTop: 10, display: "inline-flex" }}>
              Review in Queue
            </Link>
          </div>
        ) : null}
        {(latest.kind === "email_queued" || latest.kind === "calendar_queued") &&
        latest.disposition === "sent" ? (
          <div className="thread-inbox-banner" style={{ marginTop: 4, borderColor: "rgba(52, 211, 153, 0.25)" }}>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "#34d399" }}>
              Sent immediately — auto-approve is on for this action type.
            </p>
          </div>
        ) : null}
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
  const approvalDefaults = trpc.settings.getApprovalDefaults.useQuery({}, {
    staleTime: 0,
    refetchOnMount: "always",
  });
  const agentAutoApprove = approvalDefaults.data?.autoApproveAgentEmail ?? false;
  const calendarAutoApprove = approvalDefaults.data?.autoApproveCalendar ?? false;
  const approvalSettingsReady = !approvalDefaults.isLoading && approvalDefaults.data !== undefined;
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
              {approvalSettingsReady
                ? agentAutoApprove
                  ? "Auto-approve · agent"
                  : "Queue first · agent"
                : ready
                  ? status.data?.model ?? "gpt-4o-mini"
                  : "OpenAI required"}
            </span>
          </div>

          <div className="thread-agent-feed" ref={feedRef}>
            {messages.length === 0 ? (
              <div
                className="thread-rotator-bubble"
                data-approval={approvalSettingsReady ? (agentAutoApprove ? "on" : "off") : undefined}
                style={{ fontSize: 13, maxWidth: "100%" }}
              >
                <Bot size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
                <span>{agentWelcomeCopy({ agentAutoApprove, calendarAutoApprove, settingsReady: approvalSettingsReady })}</span>
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
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <AgentMentionInput
              value={input}
              onChange={setInput}
              onSubmit={() => send(input)}
              disabled={chat.isPending}
              placeholder={
                ready
                  ? "Ask Thread Agent… type @ to mention someone"
                  : "Type @ to pick a sender · set OPENAI_API_KEY to chat"
              }
            />
          </form>
        </div>

        <ActionPanel actions={lastActions} agentAutoApprove={agentAutoApprove} />
      </div>
    </div>
  );
}
