"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Calendar, LogIn, Mail, UserPlus, X } from "lucide-react";

import { trpc } from "~/trpc/client";
import { useDemoMode } from "~/hooks/use-demo-mode";
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

const DEMO_COPY: Record<
  IntegrationRequirement,
  { title: string; body: string; primaryLabel: string; icon: typeof Mail }
> = {
  gmail: {
    title: "Sign in to send for real",
    body: "This email stays in Queue on the shared demo account — nothing sends here. Sign in with your own account to connect Gmail and deliver messages.",
    primaryLabel: "Sign in to use Thread",
    icon: Mail,
  },
  calendar: {
    title: "Sign in to apply calendar actions",
    body: "This action stays in Queue on the shared demo account. Sign in with your own account to connect Google Calendar and approve sends for real.",
    primaryLabel: "Sign in to use Thread",
    icon: Calendar,
  },
};

export function ConnectRequiredModal({
  requirement,
  isDemoUser,
  onClose,
}: {
  requirement: IntegrationRequirement;
  isDemoUser?: boolean;
  onClose: () => void;
}) {
  const copy = isDemoUser ? DEMO_COPY[requirement] : COPY[requirement];
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
        <p className="thread-connect-gate-note">
          {isDemoUser
            ? "Nothing was sent. Don't connect Gmail on demo@thread.dev — it replaces sample inbox data."
            : "Nothing was sent. Your queued item is unchanged."}
        </p>
        <div className="thread-demo-expired-ctas">
          {isDemoUser ? (
            <>
              <Link
                href="/sign-in"
                className="thread-demo-expired-btn thread-demo-expired-btn--primary"
                onClick={onClose}
              >
                <LogIn size={14} />
                {copy.primaryLabel}
                <ArrowRight size={14} />
              </Link>
              <Link
                href="/sign-in"
                className="thread-demo-expired-btn thread-demo-expired-btn--ghost"
                onClick={onClose}
              >
                <UserPlus size={14} />
                Create account
              </Link>
            </>
          ) : (
            <Link
              href="/settings"
              className="thread-demo-expired-btn thread-demo-expired-btn--primary"
              onClick={onClose}
            >
              {requirement === "gmail" ? <Mail size={14} /> : <Calendar size={14} />}
              {copy.primaryLabel}
              <ArrowRight size={14} />
            </Link>
          )}
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
export function useQueueIntegrationGate(email: string | null | undefined) {
  const demo = useDemoMode(email);
  const [requirement, setRequirement] = useState<IntegrationRequirement | null>(null);

  const inboxStatus = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});

  const connections = useMemo(
    () => ({
      isDemoUser: demo.isDemo,
      gmailConnected: inboxStatus.data?.gmail === "connected",
      calendarConnected: calendarStatus.data?.googlecalendar === "connected",
    }),
    [demo.isDemo, inboxStatus.data?.gmail, calendarStatus.data?.googlecalendar],
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
    <ConnectRequiredModal
      requirement={requirement}
      isDemoUser={demo.isDemo}
      onClose={() => setRequirement(null)}
    />
  ) : null;

  return {
    checkBeforeApprove,
    showRequirementFromError,
    modal,
    connections,
  };
}
