"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Calendar,
  Clock,
  Loader2,
  Mail,
  PenLine,
  RefreshCw,
  Sparkles,
  Sun,
  Target,
} from "lucide-react";
import { toast } from "sonner";

import type { RouterOutputs } from "@repo/trpc/client";
import { trpc } from "~/trpc/client";
import { SkeletonList } from "~/components/app/skeleton-list";

type DailyBrief = RouterOutputs["ai"]["dailyBrief"];
type BriefItem = DailyBrief["needsAttention"][number];
type BriefAction = DailyBrief["recommendedActions"][number];

function urgencyColor(urgency?: BriefItem["urgency"]) {
  switch (urgency) {
    case "high":
      return "#f87171";
    case "medium":
      return "#fbbf24";
    default:
      return "var(--thread-dim)";
  }
}

function BriefSection({
  title,
  icon: Icon,
  children,
  empty,
}: {
  title: string;
  icon: typeof Sun;
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) return null;
  return (
    <section className="thread-brief-section">
      <div className="thread-brief-section-head">
        <Icon size={14} />
        <h2>{title}</h2>
      </div>
      <div className="thread-brief-section-body">{children}</div>
    </section>
  );
}

function BriefItemRow({ item }: { item: BriefItem }) {
  const href = item.threadId
    ? `/inbox?thread=${encodeURIComponent(item.threadId)}`
    : item.eventId
      ? `/calendar`
      : item.queueItemId
        ? `/queue`
        : null;

  const content = (
    <div className="thread-brief-item" data-urgency={item.urgency}>
      <span className="thread-brief-item-dot" style={{ background: urgencyColor(item.urgency) }} />
      <div className="thread-brief-item-copy">
        <strong>{item.headline}</strong>
        {item.detail ? <p>{item.detail}</p> : null}
      </div>
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="thread-brief-item-link">
      {content}
    </Link>
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
      if (action.eventId) {
        router.push("/calendar");
        return;
      }
      break;
    case "open_queue":
      router.push(action.queueItemId ? "/queue" : "/queue");
      return;
    case "open_inbox":
      router.push("/inbox");
      return;
  }
  router.push("/agent");
}

export default function BriefPage() {
  const router = useRouter();
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  const briefQuery = trpc.ai.dailyBrief.useQuery(
    { timeZone },
    {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  );

  const inboxStatus = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});
  const connected =
    inboxStatus.data?.gmail === "connected" || calendarStatus.data?.googlecalendar === "connected";

  const brief = briefQuery.data;
  const loading = briefQuery.isLoading || inboxStatus.isLoading || calendarStatus.isLoading;

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
            <Link href="/settings" className="thread-btn-accent">
              Open Settings
            </Link>
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
                  <Link href="/calendar" className="thread-btn-ghost">
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

            <div className="thread-brief-grid">
              <BriefSection
                title="Needs attention"
                icon={Mail}
                empty={brief.needsAttention.length === 0}
              >
                {brief.needsAttention.map((item, i) => (
                  <BriefItemRow key={`need-${i}`} item={item} />
                ))}
              </BriefSection>

              <BriefSection
                title="Meeting insights"
                icon={Calendar}
                empty={brief.meetingInsights.length === 0}
              >
                {brief.meetingInsights.map((item, i) => (
                  <BriefItemRow key={`meet-${i}`} item={item} />
                ))}
              </BriefSection>

              <BriefSection title="Risks" icon={AlertTriangle} empty={brief.risks.length === 0}>
                {brief.risks.map((item, i) => (
                  <BriefItemRow key={`risk-${i}`} item={item} />
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
