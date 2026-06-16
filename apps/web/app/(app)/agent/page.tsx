"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  Square,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import type { RouterOutputs } from "@repo/trpc/client";
import { AgentMentionInput } from "~/components/app/agent-mention-input";
import { SkeletonList } from "~/components/app/skeleton-list";

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
      "Draft a sick leave email to my manager for 29-30 May. Keep it professional and queue it for my approval before sending.",
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
      "Queue a 30-minute calendar invite tomorrow at 3pm titled Team sync. Queue for my approval before it goes out.",
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
  const utils = trpc.useUtils();
  const approve = trpc.queue.approve.useMutation({
    onSuccess: async () => {
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      toast.success("Approved from Agent panel");
    },
    onError: (e) => toast.error(e.message),
  });
  const dismiss = trpc.queue.dismiss.useMutation({
    onSuccess: async () => {
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      toast.success("Dismissed from Agent panel");
    },
    onError: (e) => toast.error(e.message),
  });

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
              Waiting in Queue — approve here or review all items.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {latest.queueItemId ? (
                <>
                  <button
                    type="button"
                    className="thread-btn-accent"
                    style={{ fontSize: 12, padding: "6px 12px" }}
                    disabled={approve.isPending || dismiss.isPending}
                    onClick={() => approve.mutate({ id: latest.queueItemId! })}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="thread-btn-ghost"
                    style={{ fontSize: 12, padding: "6px 12px" }}
                    disabled={approve.isPending || dismiss.isPending}
                    onClick={() => dismiss.mutate({ id: latest.queueItemId! })}
                  >
                    Dismiss
                  </button>
                </>
              ) : null}
              <Link href="/queue" className="thread-inbox-loadmore" style={{ display: "inline-flex" }}>
                Open Queue
              </Link>
            </div>
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
  const streamAbortRef = useRef<AbortController | null>(null);

  const historyQuery = trpc.agent.getHistory.useQuery({}, { staleTime: Infinity });
  const saveHistoryMutation = trpc.agent.saveHistory.useMutation();
  const clearHistoryMutation = trpc.agent.clearHistory.useMutation();

  // Load from DB first; fall back to localStorage if DB is empty.
  useEffect(() => {
    if (historyLoaded.current) return;
    if (historyQuery.isLoading) return;
    historyLoaded.current = true;
    const sanitize = (msgs: unknown[]): ChatMessage[] =>
      msgs.filter((m): m is ChatMessage => {
        if (typeof m !== "object" || m === null) return false;
        const msg = m as Record<string, unknown>;
        return (
          (msg.role === "user" || msg.role === "assistant") &&
          typeof msg.content === "string" &&
          msg.content !== "[object Object]"
        );
      });
    if (historyQuery.data && historyQuery.data.length > 0) {
      const clean = sanitize(historyQuery.data);
      setMessages(clean);
      saveLocalHistory(clean);
    } else {
      const local = sanitize(loadLocalHistory());
      if (local.length > 0) {
        setMessages(local);
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
  const searchParams = useSearchParams();
  const promptHandled = useRef(false);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isPending, streamStatus]);

  useEffect(() => {
    return () => streamAbortRef.current?.abort();
  }, []);

  const stopStream = () => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsPending(false);
    setStreamStatus(null);
    toast.message("Stopped.");
  };

  const send = (text: string) => {
    const message = text.trim();
    if (!message || isPending) return;
    if (!ready) {
      toast.message("Add OPENAI_API_KEY to enable Thread Agent.");
      return;
    }
    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    setInput("");
    setLastActions([]);
    setStreamStatus(null);
    const history = messages.slice(-12);
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setIsPending(true);

    fetch(`/agent/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-thread-csrf": "1" },
      body: JSON.stringify({ message, history, userEmail: meQuery.data?.email }),
      signal: abortController.signal,
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
                } else if (currentEvent === "token") {
                  const text = String(data.text ?? "");
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { role: "assistant", content: last.content + text }];
                    }
                    return [...prev, { role: "assistant", content: text }];
                  });
                } else if (currentEvent === "complete") {
                  const reply = String(data.reply ?? "");
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { role: "assistant", content: reply }];
                    }
                    return [...prev, { role: "assistant", content: reply }];
                  });
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
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && err.name === "AbortError") return;
        toast.error(err instanceof Error ? err.message : "Agent request failed");
      })
      .finally(() => {
        if (streamAbortRef.current === abortController) {
          streamAbortRef.current = null;
        }
        setIsPending(false);
        setStreamStatus(null);
      });
  };

  useEffect(() => {
    if (promptHandled.current) return;
    const prompt = searchParams.get("prompt")?.trim();
    if (!prompt || !ready || isPending) return;
    promptHandled.current = true;
    send(prompt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, ready, isPending]);

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
            {isPending ? (
              <button
                type="button"
                className="thread-btn-ghost"
                style={{ fontSize: 11, padding: "3px 8px", marginLeft: 6 }}
                onClick={stopStream}
                title="Stop current request"
              >
                <Square size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                Stop
              </button>
            ) : messages.length > 0 ? (
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
            {status.isLoading && messages.length === 0 ? (
              <SkeletonList count={3} />
            ) : null}
            {messages.length === 0 && !status.isLoading ? (
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
                <span style={{ whiteSpace: "pre-wrap" }}>
                  {typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}
                </span>
              </div>
            ))}

            {isPending ? (
              <div className="thread-rotator-bubble thread-agent-msg" style={{ fontSize: 13 }}>
                <Loader2 size={13} className="thread-spin" />
                <span style={{ color: "var(--thread-muted)", fontStyle: "italic" }}>
                  {streamStatus ?? "Thinking…"}
                </span>
                <button
                  type="button"
                  className="thread-btn-ghost"
                  style={{ fontSize: 11, padding: "4px 10px", marginLeft: "auto" }}
                  onClick={stopStream}
                >
                  Stop
                </button>
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
