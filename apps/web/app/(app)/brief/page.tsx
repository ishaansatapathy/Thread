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

type DailyBrief = RouterOutputs["ai"]["dailyBrief"];
type BriefItem = DailyBrief["needsAttention"][number];
type BriefAction = DailyBrief["recommendedActions"][number];
type FollowUp = RouterOutputs["ai"]["missedFollowUps"][number];

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
  onToggle,
}: {
  item: BriefItem;
  expandedId: string | null;
  onToggle: (id: string | null) => void;
}) {
  const router = useRouter();
  const isExpanded = Boolean(item.threadId && expandedId === item.threadId);
  const canExpand = Boolean(item.threadId);

  const handleClick = () => {
    if (canExpand) {
      onToggle(isExpanded ? null : item.threadId!);
    } else if (item.eventId) {
      router.push("/calendar");
    } else if (item.queueItemId) {
      router.push("/queue");
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
        {canExpand ? (
          <span className="thread-brief-item-expand-icon">
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        ) : (
          <ArrowRight size={12} style={{ opacity: 0.35, flexShrink: 0 }} />
        )}
      </button>

      {isExpanded && item.threadId ? (
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
            >
              <Mail size={12} />
              Open in inbox
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

function runBriefAction(action: BriefAction, router: ReturnType<typeof useRouter>) {
  switch (action.kind) {
    case "reply":
      if (action.threadId) {
        router.push(`/inbox?thread=${encodeURIComponent(action.threadId)}`);
        return;
      }
      break;
    case "prepare_meeting":
    case "follow_up":
    case "agent":
      if (action.agentPrompt) {
        router.push(`/agent?prompt=${encodeURIComponent(action.agentPrompt)}`);
        return;
      }
      if (action.eventId) { router.push("/calendar"); return; }
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

  const briefQuery = trpc.ai.dailyBrief.useQuery(
    { timeZone },
    { staleTime: 5 * 60_000, refetchOnWindowFocus: true, retry: 1 },
  );

  const followUpsQuery = trpc.ai.missedFollowUps.useQuery(
    { timeZone },
    { staleTime: 10 * 60_000, retry: 1 },
  );

  const inboxStatus = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});
  const connected =
    inboxStatus.data?.gmail === "connected" ||
    calendarStatus.data?.googlecalendar === "connected";

  const brief = briefQuery.data;
  const followUps = followUpsQuery.data ?? [];
  const loading = briefQuery.isLoading || inboxStatus.isLoading || calendarStatus.isLoading;

  const handleDraftFollowUp = (agentPrompt: string) => {
    router.push(`/agent?prompt=${encodeURIComponent(agentPrompt)}`);
  };

  return (
    <div className="thread-app-page">
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
            disabled={briefQuery.isFetching}
            onClick={() => {
              void briefQuery.refetch().then(() => toast.message("Brief refreshed"));
            }}
          >
            {briefQuery.isFetching ? (
              <Loader2 size={13} className="thread-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Refresh
          </button>
        </header>

        {loading ? (
          <SkeletonList count={5} />
        ) : !connected ? (
          <div className="thread-app-empty thread-brief-empty">
            <Mail size={22} style={{ opacity: 0.35 }} />
            <h2>Connect your workspace</h2>
            <p>Link Gmail or Google Calendar to generate your personal daily brief.</p>
            <Link href="/settings" className="thread-btn-accent">Open Settings</Link>
          </div>
        ) : briefQuery.isError ? (
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
                {brief.todaysFocus.threadId ? (
                  <Link
                    href={`/inbox?thread=${encodeURIComponent(brief.todaysFocus.threadId)}`}
                    className="thread-btn-accent"
                  >
                    Reply now
                  </Link>
                ) : null}
                {brief.todaysFocus.eventId ? (
                  <Link href="/calendar" className="thread-btn-ghost">View meeting</Link>
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
            ) : null}

            <div className="thread-brief-grid">
              <BriefSection
                title="Needs attention"
                icon={Mail}
                empty={brief.needsAttention.length === 0}
                badge={brief.needsAttention.filter(i => i.urgency === "high").length || undefined}
              >
                {brief.needsAttention.map((item, i) => (
                  <BriefItemRow
                    key={`need-${i}`}
                    item={item}
                    expandedId={expandedId}
                    onToggle={setExpandedId}
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
                    onToggle={setExpandedId}
                  />
                ))}
              </BriefSection>

              <BriefSection title="Risks" icon={AlertTriangle} empty={brief.risks.length === 0}>
                {brief.risks.map((item, i) => (
                  <BriefItemRow
                    key={`risk-${i}`}
                    item={item}
                    expandedId={expandedId}
                    onToggle={setExpandedId}
                  />
                ))}
              </BriefSection>
            </div>

            {brief.recommendedActions.length > 0 ? (
              <section className="thread-brief-actions">
                <div className="thread-brief-section-head">
                  <Sparkles size={14} />
                  <h2>Recommended</h2>
                </div>
                <div className="thread-brief-action-row">
                  {brief.recommendedActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="thread-brief-action-btn"
                      onClick={() => runBriefAction(action, router)}
                    >
                      {action.kind === "reply" ? <PenLine size={13} /> : null}
                      {action.kind === "prepare_meeting" ? <Calendar size={13} /> : null}
                      {action.label}
                    </button>
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
