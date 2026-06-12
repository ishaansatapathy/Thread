"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Inbox,
  Mail,
  Filter,
  Loader2,
  Send,
  FilePenLine,
  CalendarPlus,
  ListChecks,
  X,
} from "lucide-react";

import { SenderAvatar } from "~/components/app/sender-avatar";
import { localDateTimeRangeToPayload, toLocalDateTimeInput } from "~/lib/calendar-datetime";
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
  let base = trimmed;
  while (/^(re|fwd):\s*/i.test(base)) {
    base = base.replace(/^(re|fwd):\s*/i, "").trim();
  }
  return `Re: ${base || "No subject"}`;
}

function displaySender(from?: string) {
  if (!from) return "Unknown";
  const nameMatch = from.match(/^([^<]+)</);
  if (nameMatch?.[1]) {
    return nameMatch[1].trim().replace(/^"|"$/g, "");
  }
  const bracket = from.match(/<([^>]+)>/);
  return (bracket?.[1] ?? from).trim();
}

function formatMessageDate(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function replyTargetForMessage(message: { from?: string; to?: string }, userEmail?: string) {
  const from = parseReplyTo(message.from);
  const me = userEmail?.trim().toLowerCase();
  if (from && me && from.toLowerCase() === me) {
    return parseReplyTo(message.to) || from;
  }
  return from;
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState("");
  const [replySubjectValue, setReplySubjectValue] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingStart, setMeetingStart] = useState(() =>
    toLocalDateTimeInput(new Date(Date.now() + 86_400_000)),
  );
  const [meetingEnd, setMeetingEnd] = useState(() =>
    toLocalDateTimeInput(new Date(Date.now() + 86_400_000 + 3_600_000)),
  );
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery({});
  const userEmail = meQuery.data?.email;
  const userPhotoUrl = meQuery.data?.profileImageUrl;
  const statusQuery = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});
  const pendingCount = trpc.queue.pendingCount.useQuery({});
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

  const queueEmail = trpc.queue.enqueueEmail.useMutation({
    onSuccess: async () => {
      await utils.queue.pendingCount.invalidate();
      toast.success("Added to approval queue");
      setReplyBody("");
    },
    onError: (error) => toast.error(error.message),
  });

  const queueMeeting = trpc.queue.enqueueMeeting.useMutation({
    onSuccess: async () => {
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      setShowSchedule(false);
      toast.success("Meeting queued — approve from Queue to add it to Google Calendar", {
        action: {
          label: "Open Queue",
          onClick: () => {
            window.location.href = "/queue";
          },
        },
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const gmailStatus = statusQuery.data?.gmail ?? "not_configured";
  const isConnected = gmailStatus === "connected";
  const calendarConnected = calendarStatus.data?.googlecalendar === "connected";
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
    const messages = selectedQuery.data.messages ?? [];
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? null;
    setReplyTo(
      last
        ? replyTargetForMessage(last, userEmail) ||
            selectedQuery.data.suggestedReplyTo?.trim() ||
            parseReplyTo(selectedQuery.data.from)
        : selectedQuery.data.suggestedReplyTo?.trim() || parseReplyTo(selectedQuery.data.from),
    );
    setReplySubjectValue(replySubject(selectedQuery.data.subject));
    setMeetingTitle(
      selectedQuery.data.subject?.trim() ? `Sync: ${selectedQuery.data.subject}` : "Meeting",
    );
    setActiveMessageId(lastId);
    if (lastId) {
      setExpandedMessageIds(new Set([lastId]));
    }
  }, [selectedQuery.data, userEmail]);

  const threadMessages = selectedQuery.data?.messages ?? [];

  const handleMessageClick = (message: (typeof threadMessages)[number]) => {
    setActiveMessageId(message.id);
    setReplyTo(replyTargetForMessage(message, userEmail));
    setExpandedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(message.id)) {
        next.delete(message.id);
      } else {
        next.add(message.id);
      }
      return next;
    });
  };

  const connectHref = `/api-connect/gmail?state=${encodeURIComponent("/inbox")}`;
  const queueCount = pendingCount.data?.count ?? 0;

  const emailPayload = {
    to: replyTo,
    subject: replySubjectValue,
    body: replyBody,
    threadId: selectedQuery.data?.id,
  };

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
          <Link
            href="/queue"
            className="thread-inbox-queue-link"
            aria-label={`Open approval queue${queueCount ? `, ${queueCount} pending` : ""}`}
          >
            <ListChecks size={14} />
            Queue
            {queueCount > 0 ? <span className="thread-inbox-queue-badge">{queueCount}</span> : null}
          </Link>
          <button
            type="button"
            className="thread-app-iconbtn"
            style={{ width: 30, height: 30 }}
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
              <p style={{ marginTop: 12, fontSize: 12, color: "var(--thread-dim)" }}>
                Checking Gmail…
              </p>
            </div>
          ) : !isConnected ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Inbox size={20} style={{ opacity: 0.35 }} />
              <p
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--thread-muted)",
                }}
              >
                No threads yet
              </p>
              <p
                style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--thread-dim)" }}
              >
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
              <p style={{ marginTop: 12, fontSize: 12, color: "var(--thread-dim)" }}>
                Loading threads…
              </p>
            </div>
          ) : threads.length === 0 ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Inbox size={20} style={{ opacity: 0.35 }} />
              <p
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--thread-muted)",
                }}
              >
                Inbox is empty
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
              <p>Connect Gmail through Corsair to pull mail into Thread.</p>
            </div>
            <a
              href={connectHref}
              className="thread-btn-primary"
              style={{ fontSize: 13, padding: "10px 18px" }}
            >
              Connect Gmail
            </a>
          </div>
        ) : selectedQuery.isLoading ? (
          <div className="thread-app-empty">
            <Loader2 size={22} className="thread-spin" />
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--thread-dim)" }}>
              Opening thread…
            </p>
          </div>
        ) : selectedQuery.data ? (
          <div className="thread-inbox-message">
            <div className="thread-inbox-message-head">
              <div className="thread-inbox-message-head-row">
                <div>
                  <h2>{selectedQuery.data.subject?.trim() || "No subject"}</h2>
                  {threadMessages.length > 1 ? (
                    <p className="thread-inbox-message-count">
                      {threadMessages.length} messages in this conversation
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="thread-btn-ghost"
                  style={{ fontSize: 12, padding: "7px 12px", flexShrink: 0 }}
                  disabled={!calendarConnected || !replyTo.trim()}
                  onClick={() => setShowSchedule(true)}
                >
                  <CalendarPlus size={14} />
                  Schedule meeting
                </button>
              </div>
            </div>

            <div className="thread-inbox-thread">
              {threadMessages.length > 0 ? (
                threadMessages.map((message, index) => {
                  const expanded = expandedMessageIds.has(message.id);
                  const isLast = index === threadMessages.length - 1;
                  const isActive = activeMessageId === message.id;
                  return (
                    <article
                      key={message.id}
                      className="thread-inbox-msg"
                      data-expanded={expanded}
                      data-last={isLast}
                      data-active={isActive}
                    >
                      <button
                        type="button"
                        className="thread-inbox-msg-head"
                        onClick={() => handleMessageClick(message)}
                        aria-expanded={expanded}
                        aria-pressed={isActive}
                      >
                        <SenderAvatar
                          from={message.from}
                          selfEmail={userEmail}
                          selfPhotoUrl={userPhotoUrl}
                        />
                        <span className="thread-inbox-msg-summary">
                          <span className="thread-inbox-msg-top">
                            <strong>{displaySender(message.from)}</strong>
                            <span className="thread-inbox-msg-date">
                              {formatMessageDate(message.date)}
                            </span>
                          </span>
                          {!expanded ? (
                            <span className="thread-inbox-msg-snippet">
                              {message.body?.trim() || message.snippet}
                            </span>
                          ) : (
                            <span className="thread-inbox-msg-to">
                              to {displaySender(message.to) || parseReplyTo(message.to) || "you"}
                            </span>
                          )}
                        </span>
                      </button>
                      {expanded ? (
                        <div className="thread-inbox-msg-body">
                          {message.body?.trim() || message.snippet || "(No content)"}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <p className="thread-inbox-message-body">
                  {selectedQuery.data.body?.trim() || selectedQuery.data.snippet}
                </p>
              )}
            </div>

            <div className="thread-inbox-compose">
              <div className="thread-inbox-compose-head">
                <h3>Reply</h3>
                <span className="thread-mono-tag">Queued before send</span>
              </div>
              <label className="thread-set-label" htmlFor="reply-to">
                To
                {activeMessageId ? (
                  <span className="thread-inbox-reply-hint">
                    {" "}
                    — replying based on selected message
                  </span>
                ) : null}
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
                  disabled={queueEmail.isPending || !replyBody.trim()}
                  onClick={() =>
                    queueEmail.mutate({ mode: "draft", email: emailPayload, title: "Draft reply" })
                  }
                >
                  <FilePenLine size={14} />
                  Queue draft
                </button>
                <button
                  type="button"
                  className="thread-btn-accent"
                  disabled={queueEmail.isPending || !replyBody.trim() || !replyTo.trim()}
                  onClick={() =>
                    queueEmail.mutate({ mode: "send", email: emailPayload, title: "Reply email" })
                  }
                >
                  <ListChecks size={14} />
                  {queueEmail.isPending ? "Queuing…" : "Add to queue"}
                </button>
                <button
                  type="button"
                  className="thread-btn-ghost thread-inbox-send-now"
                  disabled={sendMessage.isPending || !replyBody.trim() || !replyTo.trim()}
                  onClick={() => sendMessage.mutate(emailPayload)}
                >
                  <Send size={14} />
                  Send now
                </button>
              </div>
              <p className="thread-inbox-compose-note">
                Approve queued actions from <Link href="/queue">Queue</Link>. Nothing sends until
                you approve.
              </p>
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

      {showSchedule ? (
        <div className="thread-modal-backdrop" onClick={() => setShowSchedule(false)}>
          <div className="thread-modal" onClick={(event) => event.stopPropagation()}>
            <div className="thread-modal-head">
              <h3>Schedule meeting from thread</h3>
              <button
                type="button"
                className="thread-app-iconbtn"
                onClick={() => setShowSchedule(false)}
              >
                <X size={14} />
              </button>
            </div>
            <form
              className="thread-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  const when = localDateTimeRangeToPayload(meetingStart, meetingEnd);
                  queueMeeting.mutate({
                  email: {
                    ...emailPayload,
                    body:
                      replyBody.trim() ||
                      `Looking forward to our meeting about ${meetingTitle}. Calendar invite attached.`,
                    subject: `Meeting: ${meetingTitle}`,
                  },
                  calendar: {
                    summary: meetingTitle,
                    description: `Scheduled from Thread inbox thread.`,
                    startDateTime: when.startDateTime,
                    endDateTime: when.endDateTime,
                    timeZone: when.timeZone,
                    attendeeEmails: replyTo.trim() ? [replyTo.trim()] : undefined,
                  },
                  sourceThreadId: selectedQuery.data?.id,
                  title: `Meeting with ${replyTo || "guest"}`,
                  });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Please review your dates");
                }
              }}
            >
              <label className="thread-set-label" htmlFor="meeting-title">
                Meeting title
              </label>
              <input
                id="meeting-title"
                className="thread-set-input"
                value={meetingTitle}
                onChange={(event) => setMeetingTitle(event.target.value)}
                required
              />

              <label className="thread-set-label" htmlFor="meeting-guest">
                Guest
              </label>
              <input
                id="meeting-guest"
                className="thread-set-input"
                type="email"
                value={replyTo}
                onChange={(event) => setReplyTo(event.target.value)}
                required
              />

              <div className="thread-modal-row">
                <div>
                  <label className="thread-set-label" htmlFor="meeting-start">
                    Starts
                  </label>
                  <input
                    id="meeting-start"
                    className="thread-set-input"
                    type="datetime-local"
                    value={meetingStart}
                    onChange={(event) => setMeetingStart(event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="thread-set-label" htmlFor="meeting-end">
                    Ends
                  </label>
                  <input
                    id="meeting-end"
                    className="thread-set-input"
                    type="datetime-local"
                    value={meetingEnd}
                    onChange={(event) => setMeetingEnd(event.target.value)}
                    required
                  />
                </div>
              </div>

              <label className="thread-set-label" htmlFor="meeting-email">
                Email message
              </label>
              <textarea
                id="meeting-email"
                className="thread-set-input"
                rows={4}
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                placeholder="Optional note to send with the invite…"
              />

              <div className="thread-modal-actions">
                <button
                  type="button"
                  className="thread-btn-ghost"
                  onClick={() => setShowSchedule(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="thread-btn-accent"
                  disabled={queueMeeting.isPending}
                >
                  <ListChecks size={14} />
                  {queueMeeting.isPending ? "Queuing…" : "Queue invite + email"}
                </button>
              </div>
              <p className="thread-inbox-compose-note" style={{ margin: 0 }}>
                Goes to the approval queue first. After you approve, it appears on Calendar for the
                date you picked.
              </p>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
