"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Inbox, Mail, Sparkles, Filter, Loader2, Send, FilePenLine } from "lucide-react";

import { trpc } from "~/trpc/client";

const TABS = [
  { id: "priority", label: "Priority" },
  { id: "all", label: "All" },
  { id: "drafts", label: "Drafts" },
];

function parseReplyTo(from?: string) {
  if (!from) return "";
  const bracket = from.match(/<([^>]+)>/);
  if (bracket?.[1]) return bracket[1];
  const plain = from.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  return plain?.[0] ?? from;
}

function replySubject(subject?: string) {
  const trimmed = subject?.trim() || "No subject";
  return trimmed.toLowerCase().startsWith("re:") ? trimmed : `Re: ${trimmed}`;
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState("");
  const [replySubjectValue, setReplySubjectValue] = useState("");
  const [replyBody, setReplyBody] = useState("");

  const utils = trpc.useUtils();
  const statusQuery = trpc.inbox.connectionStatus.useQuery({});
  const threadsQuery = trpc.inbox.listThreads.useQuery(
    { maxResults: 25 },
    { enabled: statusQuery.data?.gmail === "connected" },
  );
  const selectedQuery = trpc.inbox.getThread.useQuery(
    { threadId: selectedId ?? "" },
    { enabled: Boolean(selectedId) && statusQuery.data?.gmail === "connected" },
  );

  const sendMessage = trpc.inbox.sendMessage.useMutation({
    onSuccess: async () => {
      await utils.inbox.listThreads.invalidate();
      if (selectedId) await utils.inbox.getThread.invalidate({ threadId: selectedId });
      toast.success("Email sent");
      setReplyBody("");
    },
    onError: (error) => toast.error(error.message),
  });

  const createDraft = trpc.inbox.createDraft.useMutation({
    onSuccess: () => toast.success("Draft saved in Gmail"),
    onError: (error) => toast.error(error.message),
  });

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

  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      void utils.inbox.connectionStatus.invalidate();
    }
  }, [searchParams, utils]);

  useEffect(() => {
    if (!selectedQuery.data) return;
    setReplyTo(parseReplyTo(selectedQuery.data.from));
    setReplySubjectValue(replySubject(selectedQuery.data.subject));
  }, [selectedQuery.data]);

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
            <p className="thread-inbox-message-body">
              {selectedQuery.data.body?.trim() || selectedQuery.data.snippet}
            </p>

            <div className="thread-inbox-compose">
              <div className="thread-inbox-compose-head">
                <h3>Reply</h3>
                <span className="thread-mono-tag">Gmail via Corsair</span>
              </div>
              <label className="thread-set-label" htmlFor="reply-to">
                To
              </label>
              <input
                id="reply-to"
                className="thread-set-input"
                value={replyTo}
                onChange={(event) => setReplyTo(event.target.value)}
              />
              <label className="thread-set-label" htmlFor="reply-subject">
                Subject
              </label>
              <input
                id="reply-subject"
                className="thread-set-input"
                value={replySubjectValue}
                onChange={(event) => setReplySubjectValue(event.target.value)}
              />
              <label className="thread-set-label" htmlFor="reply-body">
                Message
              </label>
              <textarea
                id="reply-body"
                className="thread-set-input thread-inbox-compose-body"
                rows={8}
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                placeholder="Write your reply…"
              />
              <div className="thread-inbox-compose-actions">
                <button
                  type="button"
                  className="thread-btn-ghost"
                  disabled={createDraft.isPending || !replyBody.trim()}
                  onClick={() =>
                    createDraft.mutate({
                      to: replyTo,
                      subject: replySubjectValue,
                      body: replyBody,
                      threadId: selectedQuery.data?.id,
                    })
                  }
                >
                  <FilePenLine size={14} />
                  {createDraft.isPending ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="button"
                  className="thread-btn-accent"
                  disabled={sendMessage.isPending || !replyBody.trim() || !replyTo.trim()}
                  onClick={() =>
                    sendMessage.mutate({
                      to: replyTo,
                      subject: replySubjectValue,
                      body: replyBody,
                      threadId: selectedQuery.data?.id,
                    })
                  }
                >
                  <Send size={14} />
                  {sendMessage.isPending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
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
