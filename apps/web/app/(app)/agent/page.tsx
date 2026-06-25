"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  Calendar,
  CheckCircle2,
  Loader2,
  Mail,
  Paperclip,
  PenLine,
  Search,
  Sparkles,
  ListChecks,
  Square,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import type { RouterOutputs } from "@repo/trpc/client";
import { AgentMentionInput } from "~/components/app/agent-mention-input";
import { AgentContextPicker } from "~/components/app/agent-context-picker";
import { AgentFocusChip, type AgentFocusState } from "~/components/app/agent-focus-chip";
import { AgentSessionSidebar } from "~/components/app/agent-session-sidebar";
import { SkeletonList } from "~/components/app/skeleton-list";
import { QueryErrorState } from "~/components/app/query-error-state";
import {
  dismissBriefThread,
  dismissBriefThreadFromQueueItem,
  dismissBriefThreadsFromAgentActions,
} from "~/lib/brief-dismissals";
import { useDemoAiGuard } from "~/components/app/demo-limit-modal";
import { useQueueIntegrationGate } from "~/components/app/connect-required-modal";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ActionCard = RouterOutputs["agent"]["chat"]["actions"][number];

type ToolMemoryEntry = {
  at: string;
  tool: string;
  summary: string;
  threadId?: string;
  eventId?: string;
  query?: string;
};

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
  onQueueResolved,
  userEmail,
}: {
  actions: ActionCard[];
  agentAutoApprove: boolean;
  onQueueResolved?: () => void;
  userEmail?: string | null;
}) {
  const utils = trpc.useUtils();
  const { checkBeforeApprove, showRequirementFromError, modal: connectModal } =
    useQueueIntegrationGate(userEmail);
  const pendingQueue = trpc.queue.list.useQuery({ status: "pending" });
  const approve = trpc.queue.approve.useMutation({
    onSuccess: async (item) => {
      dismissBriefThreadFromQueueItem(item);
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      await utils.ai.dailyBrief.invalidate();
      onQueueResolved?.();
      toast.success("Approved from Agent panel");
    },
    onError: (e) => {
      void utils.queue.list.invalidate();
      if (!showRequirementFromError(e.message)) {
        toast.error(e.message);
      }
    },
  });
  const dismiss = trpc.queue.dismiss.useMutation({
    onSuccess: async () => {
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      onQueueResolved?.();
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
  const queuedAction = [...actions]
    .reverse()
    .find(
      (a) =>
        (a.kind === "email_queued" || a.kind === "calendar_queued") &&
        a.disposition === "queued" &&
        a.queueItemId,
    );
  const pendingIds = new Set((pendingQueue.data?.items ?? []).map((item: { id: string }) => item.id));
  const queuedItem = pendingQueue.data?.items.find(
    (item: { id: string }) => item.id === queuedAction?.queueItemId,
  );
  const queueItemStillPending = Boolean(
    queuedAction?.queueItemId && pendingIds.has(queuedAction.queueItemId),
  );
  const Icon = actionIcon(latest.kind);

  const handleApproveQueued = () => {
    if (!queuedAction?.queueItemId) return;
    const kind =
      queuedItem?.kind ??
      (queuedAction.kind === "calendar_queued" ? "calendar_invite" : "email_send");
    if (!checkBeforeApprove(kind)) return;
    approve.mutate({ id: queuedAction.queueItemId });
  };

  return (
    <>
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
        {queuedAction &&
        queuedAction.disposition === "queued" ? (
          <div className="thread-inbox-banner" style={{ marginTop: 4 }}>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
              {queueItemStillPending
                ? "Waiting in Queue — approve here or review all items."
                : "This item was already processed — open Queue for details."}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {queueItemStillPending && queuedAction.queueItemId ? (
                <>
                  <button
                    type="button"
                    className="thread-btn-accent"
                    style={{ fontSize: 12, padding: "6px 12px" }}
                    disabled={approve.isPending || dismiss.isPending}
                    onClick={handleApproveQueued}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="thread-btn-ghost"
                    style={{ fontSize: 12, padding: "6px 12px" }}
                    disabled={approve.isPending || dismiss.isPending}
                    onClick={() => dismiss.mutate({ id: queuedAction.queueItemId! })}
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
    {connectModal}
    </>
  );
}

export default function AgentPage() {
  const searchParams = useSearchParams();
  const urlPrompt = searchParams.get("prompt")?.trim() ?? "";
  const urlThreadId = searchParams.get("thread")?.trim() ?? "";
  const urlEventId = searchParams.get("event")?.trim() ?? "";
  const isDeepLink = Boolean(urlPrompt);

  const [input, setInput] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolMemory, setToolMemory] = useState<ToolMemoryEntry[]>([]);
  const [lastActions, setLastActions] = useState<ActionCard[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [focus, setFocus] = useState<AgentFocusState>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const promptHandled = useRef(false);
  const deepLinkHandled = useRef(false);
  const sessionBootstrapping = useRef(false);

  const utils = trpc.useUtils();
  const sessionsQuery = trpc.agent.listSessions.useQuery({ limit: 30 });
  const sessionQuery = trpc.agent.getSession.useQuery(
    { id: activeSessionId! },
    { enabled: Boolean(activeSessionId), staleTime: 0 },
  );
  const createSession = trpc.agent.createSession.useMutation();
  const updateSession = trpc.agent.updateSession.useMutation();

  const status = trpc.agent.status.useQuery({});
  const approvalDefaults = trpc.settings.getApprovalDefaults.useQuery({}, {
    staleTime: 0,
    refetchOnMount: "always",
  });
  const meQuery = trpc.auth.me.useQuery({});

  const agentAutoApprove = approvalDefaults.data?.autoApproveAgentEmail ?? false;
  const calendarAutoApprove = approvalDefaults.data?.autoApproveCalendar ?? false;
  const approvalSettingsReady = !approvalDefaults.isLoading && approvalDefaults.data !== undefined;
  const ready = status.data?.ready === true;

  const { isDemo: isDemoUser, tryFeature, modal: demoModal } = useDemoAiGuard(meQuery.data?.email, "agent");


  const applySession = useCallback((session: NonNullable<RouterOutputs["agent"]["getSession"]>) => {
    setMessages(session.messages);
    setToolMemory(session.toolMemory);
    setFocus({
      threadId: session.focus.threadId,
      eventId: session.focus.eventId,
      threadLabel: session.focus.threadLabel,
      eventLabel: session.focus.eventLabel,
    });
  }, []);

  const startNewChat = useCallback(async (opts?: { focus?: AgentFocusState; title?: string | null }) => {
    const session = await createSession.mutateAsync({
      title: opts?.title ?? null,
      focus: opts?.focus,
    });
    setActiveSessionId(session.id);
    setMessages([]);
    setToolMemory([]);
    setLastActions([]);
    setFocus(opts?.focus ?? {});
    await utils.agent.listSessions.invalidate();
    return session.id;
  }, [createSession, utils.agent.listSessions]);

  useEffect(() => {
    if (sessionReady || sessionsQuery.isLoading || sessionBootstrapping.current) return;

    sessionBootstrapping.current = true;
    void (async () => {
      try {
        if (isDeepLink && !deepLinkHandled.current) {
          deepLinkHandled.current = true;
          await startNewChat({
            focus: {
              threadId: urlThreadId || undefined,
              eventId: urlEventId || undefined,
            },
          });
          return;
        }

        const sessions = sessionsQuery.data ?? [];
        if (sessions.length > 0) {
          setActiveSessionId(sessions[0]!.id);
        } else {
          await startNewChat();
        }
      } finally {
        setSessionReady(true);
        sessionBootstrapping.current = false;
      }
    })();
  }, [isDeepLink, sessionReady, sessionsQuery.data, sessionsQuery.isLoading, startNewChat, urlEventId, urlThreadId]);

  useEffect(() => {
    if (!sessionReady || !activeSessionId || sessionsQuery.isLoading || createSession.isPending) return;
    if (sessionBootstrapping.current) return;
    const sessions = sessionsQuery.data ?? [];
    if (sessions.some((s: { id: string }) => s.id === activeSessionId)) return;
    if (sessions.length > 0) {
      setActiveSessionId(sessions[0]!.id);
      return;
    }
    sessionBootstrapping.current = true;
    void startNewChat().finally(() => {
      sessionBootstrapping.current = false;
    });
  }, [activeSessionId, createSession.isPending, sessionReady, sessionsQuery.data, sessionsQuery.isLoading, startNewChat]);

  useEffect(() => {
    if (!activeSessionId || sessionQuery.isLoading || isPending) return;
    if (!sessionQuery.data) return;
    if (isDeepLink && !promptHandled.current) return;
    applySession(sessionQuery.data);
  }, [activeSessionId, applySession, isDeepLink, isPending, sessionQuery.data, sessionQuery.isLoading]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isPending, streamStatus]);

  useEffect(() => {
    return () => streamAbortRef.current?.abort();
  }, []);

  const persistFocus = async (nextFocus: AgentFocusState) => {
    if (!activeSessionId) return;
    const hasFocus = Boolean(nextFocus.threadId || nextFocus.eventId);
    await updateSession.mutateAsync({
      id: activeSessionId,
      focus: hasFocus
        ? {
            threadId: nextFocus.threadId,
            eventId: nextFocus.eventId,
            threadLabel: nextFocus.threadLabel,
            eventLabel: nextFocus.eventLabel,
          }
        : null,
    });
    await utils.agent.getSession.invalidate({ id: activeSessionId });
  };

  const stopStream = () => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsPending(false);
    setStreamStatus(null);
    toast.message("Stopped.");
  };

  const send = (text: string) => {
    const message = text.trim();
    if (!message || isPending || !activeSessionId) return;
    if (!ready) {
      toast.message("Add OPENAI_API_KEY to enable Thread Agent.");
      return;
    }

    if (isDemoUser && !tryFeature()) return;

    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    setInput("");
    setLastActions([]);
    setStreamStatus(null);
    const hasFocus = Boolean(focus.threadId || focus.eventId);
    const history = hasFocus ? messages.slice(-4) : messages.slice(-12);
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setIsPending(true);

    fetch(`/agent/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-thread-csrf": "1" },
      body: JSON.stringify({
        message,
        sessionId: activeSessionId,
        history,
        toolMemory,
        userEmail: meQuery.data?.email,
        focusCleared: !hasFocus,
        focusThreadId: focus.threadId,
        focusEventId: focus.eventId,
        focusThreadLabel: focus.threadLabel,
        focusEventLabel: focus.eventLabel,
      }),
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
                  const tokenText = String(data.text ?? "");
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { role: "assistant", content: last.content + tokenText }];
                    }
                    return [...prev, { role: "assistant", content: tokenText }];
                  });
                } else if (currentEvent === "complete") {
                  const reply = String(data.reply ?? "");
                  const actions = (data.actions as ActionCard[]) ?? [];
                  const nextToolMemory = (data.toolMemory as ToolMemoryEntry[]) ?? toolMemory;
                  const focusCleared = Boolean(data.focusCleared);

                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { role: "assistant", content: reply }];
                    }
                    return [...prev, { role: "assistant", content: reply }];
                  });
                  setLastActions(actions);
                  setToolMemory(nextToolMemory);
                  if (focusCleared) {
                    setFocus({});
                  }
                  setStreamStatus(null);
                  dismissBriefThreadsFromAgentActions(actions);

                  const focusedThreadId = focus.threadId ?? urlThreadId;
                  if (
                    focusedThreadId &&
                    actions.some(
                      (a) =>
                        a.kind === "email_queued" ||
                        (a.kind === "thread" && a.href?.includes(urlThreadId)),
                    )
                  ) {
                    dismissBriefThread(focusedThreadId);
                  }

                  void utils.agent.listSessions.invalidate();
                  void utils.agent.getSession.invalidate({ id: activeSessionId });
                  void utils.queue.pendingCount.invalidate();
                  void utils.ai.dailyBrief.invalidate();
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
    if (!urlPrompt || !ready || isPending || !sessionReady || !activeSessionId) return;
    promptHandled.current = true;
    send(urlPrompt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPrompt, ready, isPending, sessionReady, activeSessionId]);

  const handleSelectSession = (id: string) => {
    if (id === activeSessionId || isPending) return;
    streamAbortRef.current?.abort();
    setActiveSessionId(id);
    setLastActions([]);
  };

  const handleNewChat = async () => {
    if (isPending) return;
    await startNewChat();
  };

  const handleClearFocus = async () => {
    const next = {};
    setFocus(next);
    await persistFocus(next);
  };

  const handleAttachFocus = async (next: AgentFocusState) => {
    setFocus(next);
    await persistFocus(next);
  };

  return (
    <div className="thread-app-page">
      {demoModal}
      <div className="thread-agent-layout">
        <AgentSessionSidebar
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onNewChat={() => void handleNewChat()}
          disabled={isPending || createSession.isPending}
        />

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
              ) : null}
            </div>

            <div className="thread-agent-feed" ref={feedRef}>
              {status.isError ? (
                <QueryErrorState
                  title="Agent unavailable"
                  message={status.error?.message ?? "Could not reach the agent service"}
                  onRetry={() => void status.refetch()}
                />
              ) : null}
              {sessionsQuery.isError ? (
                <QueryErrorState
                  title="Sessions unavailable"
                  message={sessionsQuery.error?.message ?? "Could not load chat sessions"}
                  onRetry={() => void sessionsQuery.refetch()}
                />
              ) : null}
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
              <div className="thread-agent-composer-wrap">
                <div className="thread-agent-focus-row">
                  <AgentFocusChip focus={focus} onClear={() => void handleClearFocus()} disabled={isPending} />
                  <button
                    type="button"
                    className="thread-agent-attach-btn"
                    onClick={() => setPickerOpen((v) => !v)}
                    disabled={isPending}
                  >
                    <Paperclip size={12} />
                    Attach
                  </button>
                </div>
                <AgentContextPicker
                  open={pickerOpen}
                  onClose={() => setPickerOpen(false)}
                  onSelect={(next) => void handleAttachFocus(next)}
                  disabled={isPending}
                />
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
              </div>
            </form>
          </div>

          <ActionPanel
            actions={lastActions}
            agentAutoApprove={agentAutoApprove}
            onQueueResolved={() => setLastActions([])}
            userEmail={meQuery.data?.email}
          />
        </div>
      </div>
    </div>
  );
}
