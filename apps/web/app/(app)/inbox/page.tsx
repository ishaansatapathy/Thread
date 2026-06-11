"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Inbox, Mail, Sparkles, Filter, Loader2 } from "lucide-react";

import { trpc } from "~/trpc/client";

const TABS = [
  { id: "priority", label: "Priority" },
  { id: "all", label: "All" },
  { id: "drafts", label: "Drafts" },
];

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const statusQuery = trpc.inbox.connectionStatus.useQuery({});
  const threadsQuery = trpc.inbox.listThreads.useQuery(
    { maxResults: 25 },
    { enabled: statusQuery.data?.gmail === "connected" },
  );
  const selectedQuery = trpc.inbox.getThread.useQuery(
    { threadId: selectedId ?? "" },
    { enabled: Boolean(selectedId) && statusQuery.data?.gmail === "connected" },
  );

  const gmailStatus = statusQuery.data?.gmail ?? "not_configured";
  const isConnected = gmailStatus === "connected";
  const threads = threadsQuery.data?.threads ?? [];

  const banner = useMemo(() => {
    const gmailConnected = searchParams.get("gmail") === "connected";
    const error = searchParams.get("error");
    if (gmailConnected) return { type: "success" as const, text: "Gmail connected successfully." };
    if (error) return { type: "error" as const, text: error };
    return null;
  }, [searchParams]);

  useEffect(() => {
    if (!selectedId && threads.length > 0) {
      setSelectedId(threads[0]?.id ?? null);
    }
  }, [threads, selectedId]);

  const connectHref = `/api-connect/gmail?state=${encodeURIComponent("/inbox")}`;

  return (
    <div className="thread-inbox">
      <div className="thread-inbox-list">
        <div className="thread-inbox-list-head">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="thread-inbox-tab"
              data-active={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className="thread-app-iconbtn"
            style={{ marginLeft: "auto", width: 30, height: 30 }}
            aria-label="Filter"
          >
            <Filter size={14} />
          </button>
        </div>

        {banner ? (
          <div
            className="thread-inbox-banner"
            data-variant={banner.type}
            style={{ margin: "10px 12px 0" }}
          >
            {banner.text}
          </div>
        ) : null}

        <div className="thread-inbox-list-body">
          {statusQuery.isLoading ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Loader2 size={18} className="thread-spin" />
              <p style={{ marginTop: 12, fontSize: 12, color: "var(--thread-dim)" }}>Checking Gmail…</p>
            </div>
          ) : !isConnected ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Inbox size={20} style={{ opacity: 0.35 }} />
              <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--thread-muted)" }}>
                No threads yet
              </p>
              <p style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--thread-dim)" }}>
                Connect Gmail via Corsair to sync your inbox here.
              </p>
              <a
                href={connectHref}
                className="thread-btn-primary"
                style={{ marginTop: 14, fontSize: 12, padding: "8px 14px", display: "inline-flex" }}
              >
                Connect Gmail
              </a>
            </div>
          ) : threadsQuery.isLoading ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Loader2 size={18} className="thread-spin" />
              <p style={{ marginTop: 12, fontSize: 12, color: "var(--thread-dim)" }}>Loading threads…</p>
            </div>
          ) : threads.length === 0 ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Inbox size={20} style={{ opacity: 0.35 }} />
              <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--thread-muted)" }}>
                Inbox is empty
              </p>
              <p style={{ marginTop: 6, fontSize: 12, color: "var(--thread-dim)" }}>
                No threads in your Gmail inbox yet.
              </p>
            </div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="thread-inbox-row"
                data-active={selectedId === thread.id}
                onClick={() => setSelectedId(thread.id)}
              >
                <span className="thread-inbox-row-subject">
                  {thread.subject?.trim() || thread.snippet?.trim() || "No subject"}
                </span>
                <span className="thread-inbox-row-snippet">{thread.snippet}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="thread-inbox-reading">
        {!isConnected ? (
          <div className="thread-app-empty">
            <div className="thread-app-empty-icon">
              <Mail size={24} />
            </div>
            <div>
              <h3>Your inbox is not connected</h3>
              <p>
                Connect Gmail through Corsair to pull mail into Thread. Login Google OAuth is separate — this
                flow requests Gmail read/send scopes and stores tokens encrypted in your database.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <a href={connectHref} className="thread-btn-primary" style={{ fontSize: 13, padding: "10px 18px" }}>
                Connect Gmail
              </a>
              <a href="/agent" className="thread-btn-ghost" style={{ fontSize: 13, padding: "10px 18px" }}>
                <Sparkles size={14} />
                Try the agent
              </a>
            </div>
            <span className="thread-example-label">Powered by Corsair — your data only</span>
          </div>
        ) : selectedQuery.isLoading ? (
          <div className="thread-app-empty">
            <Loader2 size={22} className="thread-spin" />
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--thread-dim)" }}>Opening thread…</p>
          </div>
        ) : selectedQuery.data ? (
          <div className="thread-inbox-message">
            <div className="thread-inbox-message-head">
              <h2>{selectedQuery.data.subject?.trim() || "No subject"}</h2>
              {selectedQuery.data.from ? (
                <p className="thread-inbox-message-meta">From: {selectedQuery.data.from}</p>
              ) : null}
              {selectedQuery.data.date ? (
                <p className="thread-inbox-message-meta">{selectedQuery.data.date}</p>
              ) : null}
            </div>
            <p className="thread-inbox-message-body">{selectedQuery.data.snippet}</p>
          </div>
        ) : (
          <div className="thread-app-empty">
            <div className="thread-app-empty-icon">
              <Mail size={24} />
            </div>
            <div>
              <h3>Select a thread</h3>
              <p>Choose a conversation from the list to preview it here.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
