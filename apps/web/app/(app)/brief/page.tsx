"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  PenLine,
  RefreshCw,
  Sparkles,
  Sun,
  Target,
  Timer,
} from "lucide-react";
import { toast } from "sonner";

import type { RouterOutputs } from "@repo/trpc/client";
import { trpc } from "~/trpc/client";
import { SkeletonList } from "~/components/app/skeleton-list";
import { SmartContextPanel } from "~/components/app/smart-context-panel";
import { MeetingPrepPanel } from "~/components/app/meeting-prep-panel";
import {
  dismissBriefThread,
  getDismissedBriefThreadIds,
  pruneBriefDismissals,
} from "~/lib/brief-dismissals";
import { useDemoAiGuard } from "~/components/app/demo-limit-modal";
import { isDemoLoginEnabled } from "~/lib/demo-config";

type DailyBrief = RouterOutputs["ai"]["dailyBrief"];
type BriefItem = DailyBrief["needsAttention"][number];
type BriefAction = DailyBrief["recommendedActions"][number];
type FollowUp = RouterOutputs["ai"]["missedFollowUps"][number];

function briefAgentUrl(prompt: string, threadId?: string) {
  const params = new URLSearchParams({ prompt });
  if (threadId) params.set("thread", threadId);
  return `/agent?${params.toString()}`;
}

function urgencyColor(urgency?: BriefItem["urgency"]) {
  switch (urgency) {
    case "high": return "#f87171";
    case "medium": return "#fbbf24";
    default: return "var(--thread-dim)";
  }
}

function BriefSection({
  title, icon: Icon, children, empty, badge,
}: {
  title: string;
  icon: typeof Sun;
  children: React.ReactNode;
  empty?: boolean;
  badge?: number;
}) {
  if (empty) return null;
  return (
    <section className="thread-brief-section">
      <div className="thread-brief-section-head">
        <Icon size={14} />
        <h2>{title}</h2>
        {badge != null && badge > 0 ? (
          <span className="thread-brief-badge">{badge}</span>
        ) : null}
      </div>
      <div className="thread-brief-section-body">{children}</div>
    </section>
  );
}

function BriefItemRow({
  item,
  expandedId,
  expandedEventId,
  onToggle,
  onToggleEvent,
  onDismissThread,
  timeZone,
}: {
  item: BriefItem;
  expandedId: string | null;
  expandedEventId: string | null;
  onToggle: (id: string | null) => void;
  onToggleEvent: (id: string | null) => void;
  onDismissThread?: (threadId: string) => void;
  timeZone: string;
}) {
  const router = useRouter();
  const isThreadExpanded = Boolean(item.threadId && expandedId === item.threadId);
  const isEventExpanded = Boolean(item.eventId && expandedEventId === item.eventId);
  const isExpanded = isThreadExpanded || isEventExpanded;

  const handleClick = () => {
    if (item.threadId) {
      onToggle(isThreadExpanded ? null : item.threadId);
    } else if (item.eventId) {
      onToggleEvent(isEventExpanded ? null : item.eventId);
    } else if (item.queueItemId) {
      router.push("/queue");
    } else {
      // Fallback: open agent with context — dismiss so item leaves Needs attention
      if (item.threadId) onDismissThread?.(item.threadId);
      router.push(
        briefAgentUrl(
          `Help me with: "${item.headline}". ${item.detail ?? ""}`,
          item.threadId,
        ),
      );
    }
  };

  return (
    <div className="thread-brief-item-wrap" data-expanded={isExpanded}>
      <button
        type="button"
        className="thread-brief-item thread-brief-item-btn"
        data-urgency={item.urgency}
        onClick={handleClick}
      >
        <span className="thread-brief-item-dot" style={{ background: urgencyColor(item.urgency) }} />
        <div className="thread-brief-item-copy">
          <strong>{item.headline}</strong>
          {item.detail ? <p>{item.detail}</p> : null}
        </div>
        <span className="thread-brief-item-expand-icon">
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {/* Inline thread context */}
      {isThreadExpanded && item.threadId ? (
        <div className="thread-brief-inline-context">
          <SmartContextPanel
            threadId={item.threadId}
            onOpenThread={(id) => router.push(`/inbox?thread=${encodeURIComponent(id)}`)}
          />
          <div className="thread-brief-inline-actions">
            <Link
              href={`/inbox?thread=${encodeURIComponent(item.threadId)}`}
              className="thread-btn-accent"
              style={{ fontSize: 12, padding: "7px 14px" }}
              onClick={() => onDismissThread?.(item.threadId!)}
            >
              <Mail size={12} />
              Open in inbox
            </Link>
            <Link
              href={briefAgentUrl(
                `Reply to this email: "${item.headline}". ${item.detail ?? ""} Draft or queue a reply.`,
                item.threadId,
              )}
              className="thread-btn-ghost"
              style={{ fontSize: 12, padding: "7px 14px" }}
              onClick={() => onDismissThread?.(item.threadId!)}
            >
              <Sparkles size={12} />
              Ask agent
            </Link>
          </div>
        </div>
      ) : null}

      {/* Inline meeting prep */}
      {isEventExpanded && item.eventId ? (
        <div className="thread-brief-inline-context">
          <MeetingPrepPanel
            eventId={item.eventId}
            timeZone={timeZone}
            onOpenThread={(id) => router.push(`/inbox?thread=${encodeURIComponent(id)}`)}
          />
          <div className="thread-brief-inline-actions">
            <Link
              href={`/calendar?event=${encodeURIComponent(item.eventId)}`}
              className="thread-btn-accent"
              style={{ fontSize: 12, padding: "7px 14px" }}
            >
              <Calendar size={12} />
              Open in calendar
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FollowUpRow({
  item,
  onDraft,
}: {
  item: FollowUp;
  onDraft: (prompt: string) => void;
}) {
  const eventDate = item.eventDate
    ? new Date(item.eventDate).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <div className="thread-brief-followup-row">
      <div className="thread-brief-followup-meta">
        <MessageSquare size={13} style={{ flexShrink: 0, color: "#a78bfa" }} />
        <div>
          <p className="thread-brief-followup-title">{item.eventSummary}</p>
          <p className="thread-brief-followup-sub">
            {eventDate}
            {item.attendeeNames.length > 0 ? ` · with ${item.attendeeNames.slice(0, 2).join(", ")}` : ""}
            {" · "}
            <span style={{ color: item.daysAgo >= 3 ? "#f87171" : "#fbbf24" }}>
              {item.daysAgo}d ago, no follow-up
            </span>
          </p>
        </div>
      </div>
      <button
        type="button"
        className="thread-brief-followup-btn"
        onClick={() => onDraft(item.agentPrompt)}
        title={item.suggestedSubject}
      >
        <Sparkles size={11} />
        Draft follow-up
      </button>
    </div>
  );
}

function buildBriefThreadContext(brief: DailyBrief) {
  const map = new Map<string, { headline: string; detail?: string }>();
  const add = (threadId: string | undefined, headline: string, detail?: string) => {
    if (!threadId || map.has(threadId)) return;
    map.set(threadId, { headline, detail });
  };

  add(brief.todaysFocus.threadId, brief.todaysFocus.headline, brief.todaysFocus.detail);
  for (const item of [...brief.needsAttention, ...brief.risks]) {
    add(item.threadId, item.headline, item.detail);
  }
  return map;
}

function buildBriefEventContext(brief: DailyBrief) {
  const map = new Map<string, { headline: string; detail?: string }>();
  for (const item of brief.meetingInsights) {
    if (item.eventId && !map.has(item.eventId)) {
      map.set(item.eventId, { headline: item.headline, detail: item.detail });
    }
  }
  return map;
}

function headlinesMatch(a: string, b: string) {
  const left = a.toLowerCase().trim();
  const right = b.toLowerCase().trim();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/** AI briefs often omit threadId on today's focus while the thread exists in needsAttention. */
function resolveBriefThreadTarget(
  action: BriefAction | null,
  brief: DailyBrief,
  threadContext: Map<string, { headline: string; detail?: string }>,
) {
  const explicitThreadId = action?.threadId ?? brief.todaysFocus.threadId;
  if (explicitThreadId) {
    const ctx = threadContext.get(explicitThreadId);
    return {
      threadId: explicitThreadId,
      headline: ctx?.headline ?? brief.todaysFocus.headline,
      detail: ctx?.detail ?? brief.todaysFocus.detail,
    };
  }

  const focusHeadline = brief.todaysFocus.headline;
  for (const item of [...brief.needsAttention, ...brief.risks]) {
    if (!item.threadId) continue;
    if (headlinesMatch(focusHeadline, item.headline)) {
      return { threadId: item.threadId, headline: item.headline, detail: item.detail };
    }
  }

  for (const [threadId, ctx] of threadContext) {
    if (headlinesMatch(focusHeadline, ctx.headline)) {
      return { threadId, headline: ctx.headline, detail: ctx.detail };
    }
  }

  return {
    threadId: undefined,
    headline: focusHeadline,
    detail: brief.todaysFocus.detail,
  };
}

function buildBriefAgentPrompt(
  kind: BriefAction["kind"],
  headline: string,
  detail?: string,
  action?: BriefAction,
) {
  const queueNote =
    "Queue it for my approval before sending — do not send without approval.";
  const wantsFollowUp =
    kind === "follow_up" ||
    /follow[\s-]?up/i.test(action?.label ?? "") ||
    /follow[\s-]?up/i.test(headline);
  if (wantsFollowUp) {
    return `Follow up on this email thread: "${headline}". ${detail ?? "I sent this earlier and need a response — draft a polite follow-up and queue it for my approval before sending."}`;
  }
  return `Read this email and draft a reply about: "${headline}". ${detail ?? queueNote}`;
}

function actionPreview(
  action: BriefAction,
  brief: DailyBrief,
  threadContext: Map<string, { headline: string; detail?: string }>,
  eventContext: Map<string, { headline: string; detail?: string }>,
): { headline: string; detail?: string; label: string } | null {
  if (action.threadId) {
    const ctx = threadContext.get(action.threadId);
    if (ctx) return { ...ctx, label: "About this email" };
  }
  if (action.eventId) {
    const ctx = eventContext.get(action.eventId);
    if (ctx) return { ...ctx, label: "About this meeting" };
  }
  if (action.kind === "reply" || action.kind === "follow_up") {
    const target = resolveBriefThreadTarget(action, brief, threadContext);
    return {
      headline: target.headline,
      detail: target.detail ?? brief.summary,
      label: "About this email",
    };
  }
  if (action.agentPrompt) {
    return {
      headline: action.label,
      detail: action.agentPrompt.length > 160 ? `${action.agentPrompt.slice(0, 157)}…` : action.agentPrompt,
      label: "Agent will help with",
    };
  }
  return null;
}

function BriefActionButton({
  action,
  preview,
  onRun,
}: {
  action: BriefAction;
  preview: { headline: string; detail?: string; label: string } | null;
  onRun: () => void;
}) {
  return (
    <div className="thread-brief-action-wrap">
      <button
        type="button"
        className="thread-brief-action-btn"
        onClick={onRun}
        aria-describedby={preview ? `brief-action-preview-${action.id}` : undefined}
      >
        {action.kind === "reply" ? <PenLine size={13} /> : null}
        {action.kind === "prepare_meeting" ? <Calendar size={13} /> : null}
        {action.label}
      </button>
      {preview ? (
        <div
          id={`brief-action-preview-${action.id}`}
          className="thread-brief-action-preview"
          role="tooltip"
        >
          <div className="thread-brief-action-preview-head">
            <Sparkles size={11} />
            {preview.label}
          </div>
          <strong>{preview.headline}</strong>
          {preview.detail ? <p>{preview.detail}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function runBriefAction(
  action: BriefAction,
  router: ReturnType<typeof useRouter>,
  onDismissThread?: (threadId: string) => void,
  brief?: DailyBrief | null,
  threadContext?: Map<string, { headline: string; detail?: string }>,
) {
  const threadCtxMap = threadContext ?? (brief ? buildBriefThreadContext(brief) : new Map());
  const target = brief ? resolveBriefThreadTarget(action, brief, threadCtxMap) : null;
  const threadId = action.threadId ?? target?.threadId ?? brief?.todaysFocus.threadId;

  if (threadId) onDismissThread?.(threadId);
  else if (action.threadId) onDismissThread?.(action.threadId);

  switch (action.kind) {
    case "reply":
    case "follow_up": {
      if (action.agentPrompt) {
        router.push(briefAgentUrl(action.agentPrompt, threadId));
        return;
      }
      if (brief && target) {
        router.push(
          briefAgentUrl(
            buildBriefAgentPrompt(action.kind, target.headline, target.detail, action),
            threadId,
          ),
        );
        return;
      }
      router.push(
        briefAgentUrl(
          "Read my priority email and draft a reply. Queue the email for my approval before sending.",
        ),
      );
      return;
    }
    case "prepare_meeting":
      if (action.eventId) {
        router.push(`/calendar?event=${encodeURIComponent(action.eventId)}`);
        return;
      }
      if (action.agentPrompt) {
        router.push(briefAgentUrl(action.agentPrompt, action.threadId));
        return;
      }
      router.push("/calendar");
      return;
    case "agent":
      if (action.agentPrompt) {
        router.push(briefAgentUrl(action.agentPrompt, threadId ?? action.threadId));
        return;
      }
      break;
    case "open_queue":
      router.push("/queue"); return;
    case "open_inbox":
      router.push("/inbox"); return;
  }
  router.push("/agent");
}

export default function BriefPage() {
  const router = useRouter();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  // Inline expansion state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // "While you were away" detection via localStorage
  const [awayHours, setAwayHours] = useState<number | null>(null);
  useEffect(() => {
    try {
      const key = "thread_last_active";
      const last = localStorage.getItem(key);
      const now = Date.now();
      localStorage.setItem(key, String(now));
      if (last) {
        const hours = (now - Number(last)) / (1000 * 60 * 60);
        if (hours >= 3) setAwayHours(Math.round(hours));
      }
    } catch {
      // localStorage not available (SSR/private mode)
    }
  }, []);

  // Server-persisted dismissals — merged with localStorage for instant optimistic UI.
  const [dismissedThreadIds, setDismissedThreadIds] = useState<Set<string>>(() => getDismissedBriefThreadIds());

  const dismissalsQuery = trpc.ai.getBriefDismissals.useQuery({}, { staleTime: 60_000 });
  const serverDismissMutation = trpc.ai.dismissBriefThread.useMutation();

  // Merge server dismissals into local state whenever the query resolves.
  useEffect(() => {
    if (!dismissalsQuery.data) return;
    setDismissedThreadIds((prev) => {
      const merged = new Set(prev);
      for (const id of dismissalsQuery.data.dismissedThreadIds) merged.add(id);
      return merged;
    });
  }, [dismissalsQuery.data]);

  // Re-sync from localStorage on focus (cross-tab support).
  useEffect(() => {
    const syncLocal = () => {
      const local = getDismissedBriefThreadIds();
      setDismissedThreadIds((prev) => {
        const merged = new Set(prev);
        for (const id of local) merged.add(id);
        return merged;
      });
    };
    window.addEventListener("focus", syncLocal);
    document.addEventListener("visibilitychange", syncLocal);
    return () => {
      window.removeEventListener("focus", syncLocal);
      document.removeEventListener("visibilitychange", syncLocal);
    };
  }, []);

  const markBriefThreadDismissed = (threadId: string) => {
    // Optimistic local update + localStorage for cross-tab
    dismissBriefThread(threadId);
    setDismissedThreadIds((prev) => new Set([...prev, threadId]));
    // Persist to DB in background
    serverDismissMutation.mutate({ threadId });
  };

  const [isForceRefreshing, setIsForceRefreshing] = useState(false);
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery({});
  const { isDemo: isDemoUser, tryFeature, modal: demoModal } = useDemoAiGuard(meQuery.data?.email, "mail");
  const briefQuery = trpc.ai.dailyBrief.useQuery(
    { timeZone },
    { staleTime: 60_000, refetchOnMount: "always", refetchOnWindowFocus: true, retry: 1 },
  );

  const handleForceRefresh = async () => {
    if (isDemoUser && !tryFeature()) return;
    setIsForceRefreshing(true);
    try {
      // Pass refresh:true to bypass the 5-min server-side cache and re-fetch
      // live from Corsair Gmail + Calendar + OpenAI.
      const fresh = await utils.ai.dailyBrief.fetch({ timeZone, refresh: true });
      // Push the fresh response into the normal (non-refresh) query's cache slot
      // so briefQuery.data updates without a second round-trip.
      utils.ai.dailyBrief.setData({ timeZone }, fresh);
    } finally {
      setIsForceRefreshing(false);
    }
  };

  const followUpsQuery = trpc.ai.missedFollowUps.useQuery(
    { timeZone },
    { staleTime: 10 * 60_000, retry: 1 },
  );

  const inboxStatus = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});
  const cachedThreadsQuery = trpc.inbox.listCachedThreads.useQuery({ limit: 1 }, { staleTime: 120_000 });
  const connected =
    inboxStatus.data?.gmail === "connected" ||
    calendarStatus.data?.googlecalendar === "connected";
  const hasDemoData = isDemoLoginEnabled() && (cachedThreadsQuery.data?.threads.length ?? 0) > 0;
  const canShowBrief = connected || hasDemoData || Boolean(briefQuery.data);

  const brief = briefQuery.data;
  const followUps = followUpsQuery.data ?? [];
  const loading = briefQuery.isLoading || inboxStatus.isLoading || calendarStatus.isLoading;

  useEffect(() => {
    if (!brief) return;
    const stillActive = new Set(
      brief.needsAttention.map((i) => i.threadId).filter(Boolean) as string[],
    );
    // Prune localStorage entries that are no longer in the brief
    pruneBriefDismissals(stillActive);
    // Re-read localStorage after pruning, then merge with server state
    const local = getDismissedBriefThreadIds();
    setDismissedThreadIds((prev) => {
      const merged = new Set(local);
      for (const id of prev) merged.add(id);
      return merged;
    });
  }, [brief?.generatedAt, brief?.needsAttention]);

  const visibleNeedsAttention = useMemo(
    () =>
      (brief?.needsAttention ?? []).filter(
        (item) => !item.threadId || !dismissedThreadIds.has(item.threadId),
      ),
    [brief?.needsAttention, dismissedThreadIds],
  );

  const visibleRisks = useMemo(
    () =>
      (brief?.risks ?? []).filter(
        (item) => !item.threadId || !dismissedThreadIds.has(item.threadId),
      ),
    [brief?.risks, dismissedThreadIds],
  );

  const visibleRecommendedActions = useMemo(
    () =>
      (brief?.recommendedActions ?? []).filter(
        (action) => !action.threadId || !dismissedThreadIds.has(action.threadId),
      ),
    [brief?.recommendedActions, dismissedThreadIds],
  );

  const briefThreadContext = useMemo(
    () => (brief ? buildBriefThreadContext(brief) : new Map()),
    [brief],
  );
  const briefEventContext = useMemo(
    () => (brief ? buildBriefEventContext(brief) : new Map()),
    [brief],
  );

  const handleDraftFollowUp = (agentPrompt: string) => {
    router.push(briefAgentUrl(agentPrompt));
  };

  return (
    <div className="thread-app-page">
      {demoModal}
      <div className="thread-brief-page">
        <header className="thread-brief-header">
          <div className="thread-brief-header-main">
            <Sun size={18} style={{ opacity: 0.75 }} />
            <div>
              <h1>Daily Brief</h1>
              <p>Your plan for today — what matters and what to do first.</p>
            </div>
          </div>
          <button
            type="button"
            className="thread-btn-ghost"
            disabled={briefQuery.isFetching || isForceRefreshing}
            title="Force-refresh from Gmail + Calendar (bypasses 5-min cache)"
            onClick={() => {
              void handleForceRefresh().then(() => toast.message("Brief refreshed from Corsair"));
            }}
          >
            {briefQuery.isFetching || isForceRefreshing ? (
              <Loader2 size={13} className="thread-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Refresh
          </button>
        </header>

        {!connected && hasDemoData ? (
          <div className="thread-demo-inbox-strip" style={{ marginBottom: 16 }}>
            <Sparkles size={13} />
            <span>Demo Daily Brief — AI synthesis from sample inbox + calendar data</span>
            <span className="thread-demo-inbox-strip-sep">·</span>
            <Link href="/agent" className="thread-demo-inbox-strip-link">Open Agent</Link>
          </div>
        ) : null}

        {loading ? (
          <SkeletonList count={5} />
        ) : !canShowBrief ? (
          <div className="thread-app-empty thread-brief-empty">
            <Mail size={22} style={{ opacity: 0.35 }} />
            <h2>Connect your workspace</h2>
            <p>Link Gmail or Google Calendar to generate your personal daily brief.</p>
            <Link href="/settings" className="thread-btn-accent">Open Settings</Link>
          </div>
        ) : briefQuery.isError && !briefQuery.data ? (
          <div className="thread-app-empty thread-brief-empty">
            <AlertTriangle size={22} style={{ opacity: 0.45, color: "#f87171" }} />
            <h2>Couldn&apos;t load your brief</h2>
            <p>{briefQuery.error.message}</p>
            <button type="button" className="thread-btn-accent" onClick={() => briefQuery.refetch()}>
              Try again
            </button>
          </div>
        ) : brief ? (
          <>
            {/* While You Were Away banner */}
            {awayHours != null ? (
              <div className="thread-brief-away-banner">
                <Timer size={14} />
                <span>
                  You were away for <strong>{awayHours} hour{awayHours === 1 ? "" : "s"}</strong>
                  {" "}— here&apos;s what needs your attention.
                </span>
              </div>
            ) : null}

            <div className="thread-brief-hero">
              <p className="thread-brief-greeting">{brief.greeting}</p>
              <p className="thread-brief-summary">{brief.summary}</p>
            </div>

            <div className="thread-brief-focus-card">
              <div className="thread-brief-focus-label">
                <Target size={14} />
                Today&apos;s focus
              </div>
              <h3>{brief.todaysFocus.headline}</h3>
              {brief.todaysFocus.detail ? <p>{brief.todaysFocus.detail}</p> : null}
              {brief.todaysFocus.byTime ? (
                <span className="thread-mono-tag">{brief.todaysFocus.byTime}</span>
              ) : null}
              <div className="thread-brief-focus-actions">
                {(() => {
                  const focusTarget = resolveBriefThreadTarget(null, brief, briefThreadContext);
                  if (!focusTarget.threadId && !brief.todaysFocus.headline) return null;
                  const focusPrompt = buildBriefAgentPrompt(
                    "reply",
                    focusTarget.headline,
                    focusTarget.detail,
                    { id: "focus", label: "Reply now", kind: "reply" },
                  );
                  return (
                    <Link
                      href={briefAgentUrl(focusPrompt, focusTarget.threadId)}
                      className="thread-btn-accent"
                      onClick={() => {
                        if (focusTarget.threadId) markBriefThreadDismissed(focusTarget.threadId);
                      }}
                    >
                      Reply now
                    </Link>
                  );
                })()}
                {brief.todaysFocus.eventId ? (
                  <Link href={`/calendar?event=${encodeURIComponent(brief.todaysFocus.eventId)}`} className="thread-btn-ghost">
                    View meeting
                  </Link>
                ) : null}
              </div>
            </div>

            {brief.focusWindow ? (
              <div className="thread-brief-banner">
                <Clock size={14} />
                <span>{brief.focusWindow.label}</span>
              </div>
            ) : null}

            {/* Missed follow-ups — unique section */}
            {followUps.length > 0 ? (
              <section className="thread-brief-section thread-brief-followups-section">
                <div className="thread-brief-section-head">
                  <MessageSquare size={14} />
                  <h2>Missed follow-ups</h2>
                  <span className="thread-brief-badge thread-brief-badge--amber">{followUps.length}</span>
                </div>
                <div className="thread-brief-section-body">
                  {followUps.map((fu) => (
                    <FollowUpRow
                      key={fu.eventId}
                      item={fu}
                      onDraft={handleDraftFollowUp}
                    />
                  ))}
                </div>
              </section>
            ) : followUpsQuery.isLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--thread-dim)", margin: "4px 0 12px" }}>
                <Loader2 size={12} className="thread-spin" />
                Checking for missed follow-ups…
              </div>
            ) : followUpsQuery.isError ? (
              <div style={{ fontSize: 12, color: "var(--thread-dim)", margin: "4px 0 12px" }}>
                Couldn&apos;t check follow-ups.{" "}
                <button type="button" style={{ color: "var(--thread-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }} onClick={() => followUpsQuery.refetch()}>
                  Retry
                </button>
              </div>
            ) : null}

            <div className="thread-brief-grid">
              <BriefSection
                title="Needs attention"
                icon={Mail}
                empty={visibleNeedsAttention.length === 0}
                badge={visibleNeedsAttention.filter(i => i.urgency === "high").length || undefined}
              >
                {visibleNeedsAttention.map((item, i) => (
                  <BriefItemRow
                    key={`need-${item.threadId ?? i}`}
                    item={item}
                    expandedId={expandedId}
                    expandedEventId={expandedEventId}
                    onToggle={setExpandedId}
                    onToggleEvent={setExpandedEventId}
                    onDismissThread={markBriefThreadDismissed}
                    timeZone={timeZone}
                  />
                ))}
              </BriefSection>

              <BriefSection
                title="Meeting insights"
                icon={Calendar}
                empty={brief.meetingInsights.length === 0}
              >
                {brief.meetingInsights.map((item, i) => (
                  <BriefItemRow
                    key={`meet-${i}`}
                    item={item}
                    expandedId={expandedId}
                    expandedEventId={expandedEventId}
                    onToggle={setExpandedId}
                    onToggleEvent={setExpandedEventId}
                    timeZone={timeZone}
                  />
                ))}
              </BriefSection>

              <BriefSection title="Risks" icon={AlertTriangle} empty={visibleRisks.length === 0}>
                {visibleRisks.map((item, i) => (
                  <BriefItemRow
                    key={`risk-${item.threadId ?? i}`}
                    item={item}
                    expandedId={expandedId}
                    expandedEventId={expandedEventId}
                    onToggle={setExpandedId}
                    onToggleEvent={setExpandedEventId}
                    onDismissThread={markBriefThreadDismissed}
                    timeZone={timeZone}
                  />
                ))}
              </BriefSection>
            </div>

            {visibleRecommendedActions.length > 0 ? (
              <section className="thread-brief-actions">
                <div className="thread-brief-section-head">
                  <Sparkles size={14} />
                  <h2>Recommended</h2>
                </div>
                <div className="thread-brief-action-row">
                  {visibleRecommendedActions.map((action) => (
                    <BriefActionButton
                      key={action.id}
                      action={action}
                      preview={
                        brief
                          ? actionPreview(action, brief, briefThreadContext, briefEventContext)
                          : null
                      }
                      onRun={() =>
                        runBriefAction(action, router, markBriefThreadDismissed, brief, briefThreadContext)
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
