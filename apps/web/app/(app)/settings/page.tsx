"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Calendar, ShieldCheck, User, CheckCircle2, LogOut, ListChecks, Unlink } from "lucide-react";

import { trpc } from "~/trpc/client";
import { useThreadUser, initials } from "~/components/app/use-thread-user";

function ConnectionRow({
  connected,
  connectHref,
  connectedLabel,
  onDisconnect,
  disconnecting,
}: {
  connected: boolean;
  connectHref: string;
  connectedLabel: string;
  onDisconnect: () => void;
  disconnecting?: boolean;
}) {
  if (connected) {
    return (
      <div className="thread-set-row-actions">
        <span className="thread-set-status" data-on={true}>
          {connectedLabel}
        </span>
        <button
          type="button"
          className="thread-btn-ghost thread-set-disconnect"
          disabled={disconnecting}
          onClick={onDisconnect}
        >
          <Unlink size={12} />
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    );
  }

  return (
    <a href={connectHref} className="thread-btn-accent">
      Connect
    </a>
  );
}

function ApprovalToggle({
  title,
  description,
  enabled,
  onToggle,
  disabled,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="thread-set-row">
      <span className="thread-set-row-icon">
        <ListChecks size={17} />
      </span>
      <div className="thread-set-row-meta">
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className="thread-set-toggle"
        data-on={enabled ? "true" : "false"}
        disabled={disabled}
        onClick={() => onToggle(!enabled)}
        aria-pressed={enabled}
      >
        {enabled ? "Auto-approve" : "Queue first"}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useThreadUser();
  const utils = trpc.useUtils();
  const inboxStatus = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});
  const approvalDefaults = trpc.settings.getApprovalDefaults.useQuery({});
  const [name, setName] = useState("");

  useEffect(() => {
    if (user) setName(user.displayName || user.fullName || "");
  }, [user]);

  const saveProfile = trpc.auth.setupProfile.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const toggle2FA = trpc.auth.toggle2FA.useMutation({
    onSuccess: async (res) => {
      await utils.auth.me.invalidate();
      toast.success(res.message);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateApproval = trpc.settings.updateApprovalDefaults.useMutation({
    onSuccess: async () => {
      await utils.settings.getApprovalDefaults.invalidate();
      toast.success("Approval defaults updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const setApprovalPref = (
    key: "autoApproveEmail" | "autoApproveAgentEmail" | "autoApproveCalendar",
    value: boolean,
  ) => {
    const current = approvalDefaults.data;
    if (!current) return;
    updateApproval.mutate({ ...current, [key]: value });
  };

  const logout = trpc.auth.logout.useMutation({
    onSettled: async () => {
      await utils.auth.me.reset();
      window.location.assign("/");
    },
  });

  const disconnectGmail = trpc.inbox.disconnectGmail.useMutation({
    onSuccess: async () => {
      await utils.inbox.connectionStatus.invalidate();
      toast.success("Gmail disconnected");
    },
    onError: (e) => toast.error(e.message),
  });

  const disconnectCalendar = trpc.calendar.disconnectCalendar.useMutation({
    onSuccess: async () => {
      await utils.calendar.connectionStatus.invalidate();
      toast.success("Google Calendar disconnected");
    },
    onError: (e) => toast.error(e.message),
  });

  if (!user) return null;

  const nameChanged = name.trim().length > 0 && name.trim() !== (user.displayName || user.fullName || "");

  return (
    <div className="thread-app-content-narrow">
      {/* Account */}
      <section className="thread-set-section">
        <h2>Account</h2>
        <p>Your Thread identity. Display name is what teammates and the agent use.</p>

        <div className="thread-set-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%" }}>
            <span className="thread-app-avatar" style={{ width: 44, height: 44, borderRadius: 10, fontSize: 16 }}>
              {user.profileImageUrl ? (
                // Remote Google avatar; next/image remote config is overkill for a 44px chip.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.profileImageUrl} alt="" />
              ) : (
                initials(user.displayName ?? user.fullName, user.email)
              )}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{user.fullName || "Thread user"}</div>
              <div style={{ fontSize: 12.5, color: "var(--thread-dim)" }}>{user.email}</div>
            </div>
            <span className="thread-set-status" data-on={user.emailVerified} style={{ marginLeft: "auto" }}>
              {user.emailVerified ? "Verified" : "Unverified"}
            </span>
          </div>

          <div style={{ width: "100%" }}>
            <label className="thread-set-label" htmlFor="displayName">
              Display name
            </label>
            <div className="thread-set-name-row">
              <input
                id="displayName"
                className="thread-set-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="How should we address you?"
              />
              <button
                type="button"
                className="thread-btn-accent"
                disabled={!nameChanged || saveProfile.isPending}
                onClick={() => saveProfile.mutate({ displayName: name.trim() })}
                style={{ opacity: nameChanged ? 1 : 0.5 }}
              >
                {saveProfile.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Connections */}
      <section className="thread-set-section">
        <h2>Connections</h2>
        <p>Thread reads Gmail and Calendar through Corsair. Connect once — disconnect anytime.</p>

        <div className="thread-set-row">
          <span className="thread-set-row-icon">
            <Mail size={17} />
          </span>
          <div className="thread-set-row-meta">
            <h4>Gmail</h4>
            <p>Sync threads, rank urgency, and draft replies.</p>
          </div>
          <ConnectionRow
            connected={inboxStatus.data?.gmail === "connected"}
            connectHref="/api-connect/gmail?state=/settings"
            connectedLabel="Connected"
            onDisconnect={() => disconnectGmail.mutate({})}
            disconnecting={disconnectGmail.isPending}
          />
        </div>

        <div className="thread-set-row">
          <span className="thread-set-row-icon">
            <Calendar size={17} />
          </span>
          <div className="thread-set-row-meta">
            <h4>Google Calendar</h4>
            <p>Find slots and send invites through Corsair.</p>
          </div>
          <ConnectionRow
            connected={calendarStatus.data?.googlecalendar === "connected"}
            connectHref="/api-connect/calendar?state=/settings"
            connectedLabel="Connected"
            onDisconnect={() => disconnectCalendar.mutate({})}
            disconnecting={disconnectCalendar.isPending}
          />
        </div>
      </section>

      {/* Approval defaults */}
      <section className="thread-set-section">
        <h2>Approval defaults</h2>
        <p>
          Safe by default — everything goes to Queue. Turn on auto-approve when you trust an action type
          and want it to run immediately.
        </p>

        <ApprovalToggle
          title="Email replies (Inbox)"
          description="Replies and sends composed in Inbox."
          enabled={approvalDefaults.data?.autoApproveEmail ?? false}
          disabled={approvalDefaults.isLoading || updateApproval.isPending}
          onToggle={(value) => setApprovalPref("autoApproveEmail", value)}
        />

        <ApprovalToggle
          title="Agent-composed emails"
          description="Emails drafted or sent by Thread Agent."
          enabled={approvalDefaults.data?.autoApproveAgentEmail ?? false}
          disabled={approvalDefaults.isLoading || updateApproval.isPending}
          onToggle={(value) => setApprovalPref("autoApproveAgentEmail", value)}
        />

        <ApprovalToggle
          title="Calendar actions"
          description="Invites, reschedules, deletes, and meeting bundles."
          enabled={approvalDefaults.data?.autoApproveCalendar ?? false}
          disabled={approvalDefaults.isLoading || updateApproval.isPending}
          onToggle={(value) => setApprovalPref("autoApproveCalendar", value)}
        />
      </section>

      {/* Security */}
      <section className="thread-set-section">
        <h2>Security</h2>
        <p>Add a second factor for email sign-in. Google sign-in already uses Google&apos;s security.</p>

        <div className="thread-set-row">
          <span className="thread-set-row-icon">
            <ShieldCheck size={17} />
          </span>
          <div className="thread-set-row-meta">
            <h4>Two-factor authentication</h4>
            <p>{user.twoFactorEnabled ? "Enabled — a code is required at sign-in." : "Off — enable for an extra layer."}</p>
          </div>
          <button
            type="button"
            className={user.twoFactorEnabled ? "thread-btn-ghost" : "thread-btn-accent"}
            disabled={toggle2FA.isPending}
            onClick={() => toggle2FA.mutate({ enabled: !user.twoFactorEnabled })}
            style={{ fontSize: 13, padding: "8px 16px" }}
          >
            {toggle2FA.isPending ? "Updating…" : user.twoFactorEnabled ? "Disable" : "Enable"}
          </button>
        </div>
      </section>

      {/* Session */}
      <section className="thread-set-section">
        <h2>Session</h2>
        <p>Signed in as {user.email}.</p>
        <div className="thread-set-row">
          <span className="thread-set-row-icon">
            <User size={17} />
          </span>
          <div className="thread-set-row-meta">
            <h4>Sign out</h4>
            <p>End your session on this device.</p>
          </div>
          <button
            type="button"
            className="thread-btn-ghost"
            onClick={() => logout.mutate({})}
            disabled={logout.isPending}
            style={{ fontSize: 13, padding: "8px 16px" }}
          >
            <LogOut size={14} />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>

        <p style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--thread-dim)", marginTop: 14 }}>
          <CheckCircle2 size={13} color="#34d399" />
          Your mail stays in your Postgres + Google account.
        </p>
      </section>
    </div>
  );
}
