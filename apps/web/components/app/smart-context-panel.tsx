"use client";

import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Clock,
  Loader2,
  Mail,
  Sparkles,
  User,
  TrendingUp,
} from "lucide-react";
import { trpc } from "~/trpc/client";

interface Props {
  threadId: string;
  onOpenThread?: (id: string) => void;
}

export function SmartContextPanel({ threadId, onOpenThread }: Props) {
  const router = useRouter();

  const ctx = trpc.ai.threadContext.useQuery(
    { threadId },
    {
      enabled: Boolean(threadId),
      staleTime: 5 * 60 * 1000,
    },
  );

  const senderEmail = ctx.data?.senderInfo?.email ?? "";
  const contactQuery = trpc.ai.contactIntel.useQuery(
    { email: senderEmail, name: ctx.data?.senderInfo?.name },
    { enabled: Boolean(senderEmail), staleTime: 10 * 60 * 1000 },
  );

  if (ctx.isLoading) {
    return (
      <div className="scp-root">
        <div className="scp-header">
          <Sparkles size={13} />
          <span>AI Context</span>
        </div>
        <div className="scp-loading">
          <Loader2 size={14} className="thread-spin" />
          <span>Analyzing…</span>
        </div>
      </div>
    );
  }

  if (ctx.error) {
    return (
      <div className="scp-root">
        <div className="scp-header"><Sparkles size={13} /><span>AI Context</span></div>
        <p className="scp-text" style={{ color: "var(--thread-dim)", fontSize: 12 }}>
          Couldn&apos;t load context.{" "}
          <button type="button" style={{ color: "var(--thread-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }} onClick={() => ctx.refetch()}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  if (!ctx.data) return null;

  const d = ctx.data;

  return (
    <div className="scp-root">
      <div className="scp-header">
        <Sparkles size={13} />
        <span>AI Context</span>
      </div>

      {/* Why it matters */}
      <div className="scp-block">
        <p className="scp-label">Why this matters</p>
        <p className="scp-text">{d.whyMatters}</p>
      </div>

      {/* Next action */}
      <div className="scp-block scp-action-block">
        <ArrowRight size={13} style={{ flexShrink: 0, marginTop: 1, color: "var(--thread-accent)" }} />
        <div>
          <p className="scp-label">Best next action</p>
          <p className="scp-text">{d.nextAction}</p>
        </div>
      </div>

      {/* Follow-up needed */}
      {d.isFollowUpNeeded ? (
        <div className="scp-block scp-followup-block">
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1, color: "#f59e0b" }} />
          <div>
            <p className="scp-label" style={{ color: "#f59e0b" }}>Follow-up needed</p>
            {d.followUpSuggestion ? (
              <p className="scp-text" style={{ fontStyle: "italic", opacity: 0.85 }}>
                &quot;{d.followUpSuggestion}&quot;
              </p>
            ) : (
              <p className="scp-text">You should send a follow-up.</p>
            )}
          </div>
        </div>
      ) : null}

      {/* Related emails */}
      {d.relatedThreads.length > 0 ? (
        <div className="scp-block">
          <p className="scp-label">
            <Mail size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            Related emails
          </p>
          <ul className="scp-list">
            {d.relatedThreads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="scp-list-item"
                  onClick={() => onOpenThread?.(t.id)}
                  title={`Open: ${t.subject}`}
                >
                  <span className="scp-list-subject">{t.subject}</span>
                  <span className="scp-list-meta">{t.from}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Related calendar events */}
      {d.relatedEvents.length > 0 ? (
        <div className="scp-block">
          <p className="scp-label">
            <Calendar size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            Related meetings
          </p>
          <ul className="scp-list">
            {d.relatedEvents.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="scp-list-item"
                  onClick={() => router.push(`/calendar?event=${e.id}`)}
                  title={`View: ${e.summary}`}
                >
                  <span className="scp-list-subject">{e.summary}</span>
                  {e.start ? (
                    <span className="scp-list-meta">
                      <Clock size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                      {new Date(e.start).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Sender info */}
      {d.senderInfo ? (
        <div className="scp-block">
          <p className="scp-label">
            <User size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            Sender
          </p>
          <p className="scp-text">
            {d.senderInfo.name ?? d.senderInfo.email}
            {d.senderInfo.lastInteractionDaysAgo != null ? (
              <span className="scp-meta-sub"> · last {d.senderInfo.lastInteractionDaysAgo}d ago</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {/* Relationship Intelligence (Contact Intel) */}
      {contactQuery.data && (contactQuery.data.totalInteractions > 0 || contactQuery.data.relationshipSummary) ? (
        <div className="scp-block">
          <p className="scp-label">
            <TrendingUp size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            Relationship Intel
          </p>
          <p className="scp-text">{contactQuery.data.relationshipSummary}</p>
          <div className="scp-relationship-meta">
            {contactQuery.data.totalInteractions > 0 && (
              <span className="scp-meta-chip">{contactQuery.data.totalInteractions} emails</span>
            )}
            {contactQuery.data.responseRate != null && (
              <span className="scp-meta-chip" title="Share of your emails this contact replied to">
                {contactQuery.data.responseRate >= 0.7
                  ? "Responsive contact"
                  : contactQuery.data.responseRate >= 0.4
                    ? "Mixed response pattern"
                    : "Often one-sided"}
              </span>
            )}
            {contactQuery.data.lastInteractionDaysAgo != null && (
              <span className="scp-meta-chip">Last active {contactQuery.data.lastInteractionDaysAgo}d ago</span>
            )}
          </div>
          {contactQuery.data.recentTopics.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {contactQuery.data.recentTopics.map((topic) => (
                <span key={topic} className="thread-topic-chip">
                  {topic}
                </span>
              ))}
            </div>
          )}
          <p className="scp-text" style={{ marginTop: 4, fontStyle: "italic", opacity: 0.8 }}>
            {contactQuery.data.recommendedAction}
          </p>
        </div>
      ) : null}
    </div>
  );
}
