"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Calendar, ShieldCheck, User, CheckCircle2, LogOut } from "lucide-react";

import { trpc } from "~/trpc/client";
import { useThreadUser, initials } from "~/components/app/use-thread-user";

function ConnectionButton({
  connected,
  connectHref,
  connectedLabel,
}: {
  connected: boolean;
  connectHref: string;
  connectedLabel: string;
}) {
  if (connected) {
    return (
      <span className="thread-set-status" data-on={true}>
        {connectedLabel}
      </span>
    );
  }

  return (
    <a href={connectHref} className="thread-btn-accent">
      Connect
    </a>
  );
}

export default function SettingsPage() {
  const { user } = useThreadUser();
  const utils = trpc.useUtils();
  const inboxStatus = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});
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

  const logout = trpc.auth.logout.useMutation({
    onSettled: async () => {
      await utils.auth.me.reset();
      window.location.assign("/");
    },
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
              {user.profileImageUrl ? <img src={user.profileImageUrl} alt="" /> : initials(user.displayName ?? user.fullName, user.email)}
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
            <div style={{ display: "flex", gap: 10 }}>
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
          <ConnectionButton
            connected={inboxStatus.data?.gmail === "connected"}
            connectHref="/api-connect/gmail?state=/settings"
            connectedLabel="Connected"
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
          <ConnectionButton
            connected={calendarStatus.data?.googlecalendar === "connected"}
            connectHref="/api-connect/calendar?state=/settings"
            connectedLabel="Connected"
          />
        </div>
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
