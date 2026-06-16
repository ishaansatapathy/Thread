"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  Sparkles,
  Users,
} from "lucide-react";
import { trpc } from "~/trpc/client";

interface Props {
  eventId: string;
  timeZone?: string;
  onOpenThread?: (id: string) => void;
}

export function MeetingPrepPanel({ eventId, timeZone, onOpenThread }: Props) {
  const prep = trpc.ai.meetingPrep.useQuery(
    { eventId, timeZone },
    {
      enabled: Boolean(eventId),
      staleTime: 5 * 60 * 1000,
    },
  );

  if (prep.isLoading) {
    return (
      <div className="mpp-root">
        <div className="mpp-header">
          <Sparkles size={13} />
          <span>Meeting Prep</span>
        </div>
        <div className="mpp-loading">
          <Loader2 size={14} className="thread-spin" />
          <span>Preparing briefing…</span>
        </div>
      </div>
    );
  }

  if (prep.error) {
    return (
      <div className="mpp-root">
        <div className="mpp-header"><Sparkles size={13} /><span>Meeting Prep</span></div>
        <p className="mpp-text" style={{ color: "var(--thread-dim)", fontSize: 12 }}>
          Couldn&apos;t load prep.{" "}
          <button type="button" style={{ color: "var(--thread-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }} onClick={() => prep.refetch()}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  if (!prep.data) return null;

  const d = prep.data;

  return (
    <div className="mpp-root">
      <div className="mpp-header">
        <Sparkles size={13} />
        <span>Meeting Prep</span>
        <span className="mpp-title-name">{d.summary}</span>
      </div>

      {/* Prep note */}
      <div className="mpp-prep-note">
        <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1, color: "var(--thread-accent)" }} />
        <p>{d.prepNote}</p>
      </div>

      {/* Attendees */}
      {d.attendeeNames.length > 0 ? (
        <div className="mpp-block">
          <p className="mpp-label">
            <Users size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            Attendees
          </p>
          <p className="mpp-text">{d.attendeeNames.join(", ")}</p>
        </div>
      ) : null}

      {/* Agenda */}
      {d.agenda && d.agenda !== "No agenda provided." ? (
        <div className="mpp-block">
          <p className="mpp-label">Agenda</p>
          <p className="mpp-text" style={{ whiteSpace: "pre-line" }}>{d.agenda}</p>
        </div>
      ) : null}

      {/* Talking points */}
      {d.talkingPoints.length > 0 ? (
        <div className="mpp-block">
          <p className="mpp-label">
            <MessageSquare size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            Talking points
          </p>
          <ul className="mpp-list">
            {d.talkingPoints.map((point, i) => (
              <li key={i} className="mpp-list-item">
                {point}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Risks */}
      {d.risks.length > 0 ? (
        <div className="mpp-block">
          <p className="mpp-label" style={{ color: "#f59e0b" }}>
            <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            Risks
          </p>
          <ul className="mpp-list">
            {d.risks.map((risk, i) => (
              <li key={i} className="mpp-list-item mpp-risk">
                {risk}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Related emails */}
      {d.relatedEmails.length > 0 ? (
        <div className="mpp-block">
          <p className="mpp-label">
            <Mail size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            Related emails
          </p>
          <ul className="mpp-list mpp-email-list">
            {d.relatedEmails.slice(0, 4).map((email) => (
              <li key={email.id}>
                <button
                  type="button"
                  className="mpp-email-item"
                  onClick={() => onOpenThread?.(email.id)}
                  title={email.snippet}
                >
                  <span className="mpp-email-subject">{email.subject}</span>
                  <span className="mpp-email-from">{email.from}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
