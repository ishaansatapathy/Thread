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

const HISTORY_KEY = "thread:agent:history";
const MAX_STORED_MESSAGES = 40;

function loadLocalHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

function saveLocalHistory(messages: ChatMessage[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // localStorage unavailable (SSR / private mode)
  }
}

export default function AgentPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastActions, setLastActions] = useState<ActionCard[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const historyLoaded = useRef(false);

  const historyQuery = trpc.agent.getHistory.useQuery({}, { staleTime: Infinity });
  const saveHistoryMutation = trpc.agent.saveHistory.useMutation();
  const clearHistoryMutation = trpc.agent.clearHistory.useMutation();

  // Load from DB first; fall back to localStorage if DB is empty.
  useEffect(() => {
    if (historyLoaded.current) return;
    if (historyQuery.isLoading) return;
    historyLoaded.current = true;
    if (historyQuery.data && historyQuery.data.length > 0) {
      setMessages(historyQuery.data as ChatMessage[]);
      // Sync localStorage too
      saveLocalHistory(historyQuery.data as ChatMessage[]);
    } else {
      const local = loadLocalHistory();
      if (local.length > 0) {
        setMessages(local);
        // Back-fill DB from localStorage
        saveHistoryMutation.mutate({ messages: local });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuery.isLoading, historyQuery.data]);

  // Persist to both DB and localStorage on every message change.
  useEffect(() => {
    if (!historyLoaded.current || messages.length === 0) return;
    saveLocalHistory(messages);
    saveHistoryMutation.mutate({ messages: messages.slice(-MAX_STORED_MESSAGES) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

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

  const meQuery = trpc.auth.me.useQuery({});

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isPending, streamStatus]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || isPending) return;
    if (!ready) {
      toast.message("Add OPENAI_API_KEY to enable Thread Agent.");
      return;
    }
    setInput("");
    setLastActions([]);
    setStreamStatus(null);
    const history = messages.slice(-12);
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setIsPending(true);

    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

    fetch(`${API_URL}/agent/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, userEmail: meQuery.data?.email }),
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: "Agent request failed" }));
          throw new Error((err as { error?: string }).error ?? "Agent request failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              try {
                const data = JSON.parse(dataStr) as Record<string, unknown>;
                if (currentEvent === "status") {
                  setStreamStatus(String(data.label ?? "Working…"));
                } else if (currentEvent === "complete") {
                  setMessages((prev) => [...prev, { role: "assistant", content: String(data.reply ?? "") }]);
                  setLastActions((data.actions as ActionCard[]) ?? []);
                  setStreamStatus(null);
                  void utils.queue.pendingCount.invalidate();
                } else if (currentEvent === "error") {
                  throw new Error(String(data.message ?? "Agent error"));
                }
              } catch (parseErr) {
                if (parseErr instanceof SyntaxError) continue;
                throw parseErr;
              }
              currentEvent = "";
            }
          }
        }
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Agent request failed");
      })
      .finally(() => {
        setIsPending(false);
        setStreamStatus(null);
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
            {messages.length > 0 ? (
              <button
                type="button"
                className="thread-btn-ghost"
                style={{ fontSize: 11, padding: "3px 8px", marginLeft: 6 }}
                onClick={() => {
                  setMessages([]);
                  setLastActions([]);
                  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
                  clearHistoryMutation.mutate({});
                }}
                title="Clear conversation history"
              >
                Clear
              </button>
            ) : null}
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

            {isPending ? (
              <div className="thread-rotator-bubble thread-agent-msg" style={{ fontSize: 13 }}>
                <Loader2 size={13} className="thread-spin" />
                <span style={{ color: "var(--thread-muted)", fontStyle: "italic" }}>
                  {streamStatus ?? "Thinking…"}
                </span>
              </div>
            ) : null}

            {!isPending && messages.length === 0 ? (
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
              disabled={isPending}
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
