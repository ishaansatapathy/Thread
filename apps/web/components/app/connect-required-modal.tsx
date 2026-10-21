"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Calendar, Mail, X } from "lucide-react";

import { trpc } from "~/trpc/client";
import {
  getQueueIntegrationRequirement,
  integrationRequirementFromError,
  type IntegrationRequirement,
} from "~/lib/queue-integration-gate";

const COPY: Record<
  IntegrationRequirement,
  { title: string; body: string; primaryLabel: string; icon: typeof Mail }
> = {
  gmail: {
    title: "Connect Gmail to send",
    body: "This email stays in your Queue until you approve it. Connect Gmail in Settings to deliver messages from Thread.",
    primaryLabel: "Connect Gmail",
    icon: Mail,
  },
  calendar: {
    title: "Connect Google Calendar",
    body: "This calendar action stays in your Queue until you approve it. Connect Calendar in Settings to apply changes.",
    primaryLabel: "Connect Calendar",
    icon: Calendar,
  },
};

export function ConnectRequiredModal({
  requirement,
  onClose,
}: {
  requirement: IntegrationRequirement;
  onClose: () => void;
}) {
  const copy = COPY[requirement];
  const Icon = copy.icon;

  return (
    <div
      className="thread-demo-expired-overlay"
      role="dialog"
      aria-modal
      aria-label={copy.title}
      onClick={onClose}
    >
      <div
        className="thread-demo-expired-card thread-connect-gate-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="thread-connect-gate-icon" data-service={requirement}>
          <Icon size={22} />
        </div>
        <h2 className="thread-demo-expired-title">{copy.title}</h2>
        <p className="thread-demo-expired-body">{copy.body}</p>
        <p className="thread-connect-gate-note">Nothing was sent. Your queued item is unchanged.</p>
        <div className="thread-demo-expired-ctas">
          <Link
            href="/settings"
            className="thread-demo-expired-btn thread-demo-expired-btn--primary"
            onClick={onClose}
          >
            {requirement === "gmail" ? <Mail size={14} /> : <Calendar size={14} />}
            {copy.primaryLabel}
            <ArrowRight size={14} />
          </Link>
          <button
            type="button"
            className="thread-demo-expired-btn thread-demo-expired-btn--ghost"
            onClick={onClose}
          >
            Stay in Queue
          </button>
        </div>
        <button type="button" className="thread-demo-expired-close" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/** Block queue approve when Gmail/Calendar is required but not connected. */
export function useQueueIntegrationGate(_email?: string | null) {
  const [requirement, setRequirement] = useState<IntegrationRequirement | null>(null);

  const inboxStatus = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});

  const connections = useMemo(
    () => ({
      gmailConnected: inboxStatus.data?.gmail === "connected",
      calendarConnected: calendarStatus.data?.googlecalendar === "connected",
    }),
    [inboxStatus.data?.gmail, calendarStatus.data?.googlecalendar],
  );

  const checkBeforeApprove = useCallback(
    (kind: string): boolean => {
      const needed = getQueueIntegrationRequirement(kind, connections);
      if (needed) {
        setRequirement(needed);
        return false;
      }
      return true;
    },
    [connections],
  );

  const showRequirementFromError = useCallback((message: string) => {
    const needed = integrationRequirementFromError(message);
    if (needed) setRequirement(needed);
    return needed;
  }, []);

  const modal = requirement ? (
    <ConnectRequiredModal requirement={requirement} onClose={() => setRequirement(null)} />
  ) : null;

  return {
    checkBeforeApprove,
    showRequirementFromError,
    modal,
    connections,
  };
}
