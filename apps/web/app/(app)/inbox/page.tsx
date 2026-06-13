"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Inbox,
  Mail,
  Loader2,
  FilePenLine,
  FileText,
  Archive,
  CalendarPlus,
  ListChecks,
  X,
  Search,
  Sparkles,
} from "lucide-react";

import { SenderAvatar } from "~/components/app/sender-avatar";
import { EmailMessageBody } from "~/components/app/email-message-body";
import { queueResultMessage } from "~/lib/queue-toast";
import { localDateTimeRangeToPayload, toLocalDateTimeInput } from "~/lib/calendar-datetime";
import {
  decodeHtmlEntities,
  displaySender,
  formatListDate,
  formatMessageDate,
  listThreadSubject,
  parseReplyTo,
  replySubject,
  replyTargetForMessage,
  sortThreadsByRank,
} from "~/lib/inbox-display";
import type { RouterOutputs } from "@repo/trpc/client";
import { INBOX_PAGE_SIZE } from "@repo/services/inbox";
import { trpc } from "~/trpc/client";

type InboxView = "inbox" | "priority" | "drafts";
type ThreadRow = RouterOutputs["inbox"]["listThreads"]["threads"][number];

const PAGE_SIZE = INBOX_PAGE_SIZE;

/**
 * Manual pagination + search accumulator. tRPC's useInfiniteQuery expects a
 * `cursor` field, but our REST-friendly endpoint uses Gmail's native
 * `pageToken`, so we page explicitly and merge results de-duplicated by id.
 *
 * Cache-first: Postgres snapshot paints instantly; live Gmail refresh follows.
 */
function useInboxThreads(query: string, enabled: boolean) {
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<{ token: string | undefined; threads: ThreadRow[] }[]>([]);
  const [refreshLive, setRefreshLive] = useState(false);
  const [persistedNextPageToken, setPersistedNextPageToken] = useState<string | undefined>();
  const isFirstPage = pageToken === undefined;

  const cached = trpc.inbox.listCachedThreads.useQuery(
    { limit: PAGE_SIZE, query: query || undefined },
    { enabled: enabled && isFirstPage, staleTime: 60_000 },
  );

  const result = trpc.inbox.listThreads.useQuery(
    {
      maxResults: PAGE_SIZE,
      query: query || undefined,
      pageToken,
      refresh: refreshLive && isFirstPage ? true : undefined,
    },
    { enabled, placeholderData: (prev) => prev },
  );

  useEffect(() => {
    setPageToken(undefined);
    setPages([]);
    setRefreshLive(false);
    setPersistedNextPageToken(undefined);
  }, [query]);

  useEffect(() => {
    if (result.data?.nextPageToken) {
      setPersistedNextPageToken(result.data.nextPageToken);
    }
  }, [result.data?.nextPageToken]);

  useEffect(() => {
    if (result.data?.stale && isFirstPage && !refreshLive) {
      setRefreshLive(true);
    }
  }, [result.data?.stale, isFirstPage, refreshLive]);

  useEffect(() => {
    if (!result.data) return;
    setPages((current) => {
      const existingIndex = current.findIndex((page) => page.token === pageToken);
      if (existingIndex >= 0) {
        if (result.data.stale) return current;
        const next = [...current];
        next[existingIndex] = { token: pageToken, threads: result.data.threads };
        return next;
      }
      return [...current, { token: pageToken, threads: result.data.threads }];
    });
  }, [result.data, pageToken]);

  const threads = useMemo(() => {
    const seen = new Set<string>();
    const merged: ThreadRow[] = [];
    for (const page of pages) {
      for (const thread of page.threads) {
        if (seen.has(thread.id)) continue;
        seen.add(thread.id);
        merged.push(thread);
      }
    }
    if (merged.length > 0) return merged;
    if (isFirstPage && cached.data?.threads.length) return cached.data.threads;
    return [];
  }, [pages, isFirstPage, cached.data?.threads]);

  const nextPageToken = result.data?.nextPageToken ?? persistedNextPageToken;
  const loadMore = useCallback(() => {
    if (nextPageToken) setPageToken(nextPageToken);
  }, [nextPageToken]);

  const hasCachedPreview = isFirstPage && Boolean(cached.data?.threads.length);
  const isLoading = result.isLoading && threads.length === 0;
  const isRefreshing =
    result.isFetching && threads.length > 0 && (refreshLive || result.data?.stale === true);

  return {
    threads,
    nextPageToken,
    loadMore,
    isLoading,
    isFetchingMore: result.isFetching && pageToken !== undefined,
    isRefreshing,
    hasCachedPreview,
    dataUpdatedAt: result.dataUpdatedAt,
  };
}

function useDrafts(enabled: boolean) {
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<
    { token: string | undefined; drafts: RouterOutputs["inbox"]["listDrafts"]["drafts"] }[]
  >([]);

  const result = trpc.inbox.listDrafts.useQuery(
    { maxResults: PAGE_SIZE, pageToken },
    { enabled, placeholderData: (prev) => prev },
  );

  useEffect(() => {
    if (!result.data) return;
    setPages((current) => {
      if (current.some((page) => page.token === pageToken)) return current;
      return [...current, { token: pageToken, drafts: result.data.drafts }];
    });
  }, [result.data, pageToken]);

  const drafts = useMemo(() => {
    const seen = new Set<string>();
    const merged: RouterOutputs["inbox"]["listDrafts"]["drafts"] = [];
    for (const page of pages) {
      for (const draft of page.drafts) {
        if (seen.has(draft.id)) continue;
        seen.add(draft.id);
        merged.push(draft);
      }
    }
    return merged;
  }, [pages]);

  const nextPageToken = result.data?.nextPageToken;
  const loadMore = useCallback(() => {
    if (nextPageToken) setPageToken(nextPageToken);
  }, [nextPageToken]);

  return {
    drafts,
    nextPageToken,
    loadMore,
    isLoading: result.isLoading && pages.length === 0,
    isFetchingMore: result.isFetching && pageToken !== undefined,
  };
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<InboxView>("inbox");
  const [priorityRankedIds, setPriorityRankedIds] = useState<string[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
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
  const searchRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery({});
  const userEmail = meQuery.data?.email;
  const userPhotoUrl = meQuery.data?.profileImageUrl;
  const statusQuery = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});
  const pendingCount = trpc.queue.pendingCount.useQuery({});
  const aiStatus = trpc.ai.status.useQuery({});

  const isConnected = statusQuery.data?.gmail === "connected";

  const markRead = trpc.inbox.markThreadRead.useMutation({
    onSuccess: (_data, variables) => {
      // Optimistically flip unread=false in the cached thread list.
      utils.inbox.listThreads.setData(
        { maxResults: PAGE_SIZE, query: appliedQuery || undefined },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            threads: old.threads.map((t) =>
              t.id === variables.threadId ? { ...t, unread: false } : t,
            ),
          };
        },
      );
    },
  });

  const archiveThread = trpc.inbox.archiveThread.useMutation({
    onSuccess: (_data, variables) => {
      // Optimistically remove from thread list.
      utils.inbox.listThreads.setData(
        { maxResults: PAGE_SIZE, query: appliedQuery || undefined },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            threads: old.threads.filter((t) => t.id !== variables.threadId),
          };
        },
      );
      setSelectedId(null);
      toast.success("Thread archived");
    },
    onError: (error) => toast.error(error.message),
  });

  // Debounce the search box so each keystroke doesn't hit Gmail.
  useEffect(() => {
    const id = window.setTimeout(() => setAppliedQuery(searchInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    if (searchParams.get("focus") === "search") {
      setView("inbox");
      window.setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [searchParams]);

  const inbox = useInboxThreads(appliedQuery, isConnected);
  const threads = inbox.threads;

  const drafts = useDrafts(isConnected && view === "drafts");

  const selectedQuery = trpc.inbox.getThread.useQuery(
    { threadId: selectedId ?? "" },
    { enabled: Boolean(selectedId) && isConnected },
  );

  const queueEmail = trpc.queue.enqueueEmail.useMutation({
    onSuccess: async (item) => {
      await utils.queue.pendingCount.invalidate();
      toast.success(queueResultMessage(item).title);
      setReplyBody("");
    },
    onError: (error) => toast.error(error.message),
  });

  const rankThreads = trpc.ai.rankInboxThreads.useMutation({
    onSuccess: (result) => {
      setPriorityRankedIds(result.rankedIds);
    },
    onError: (error) => toast.error(error.message),
  });

  const queueMeeting = trpc.queue.enqueueMeeting.useMutation({
    onSuccess: async (item) => {
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      setShowSchedule(false);
      const msg = queueResultMessage(item);
      if (msg.queued) {
        toast.success(msg.title, {
          action: {
            label: "Open Queue",
            onClick: () => {
              window.location.href = "/queue";
            },
          },
        });
      } else {
        toast.success(msg.title);
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const calendarConnected = calendarStatus.data?.googlecalendar === "connected";
  const aiReady = aiStatus.data?.openai === true;

  const visibleThreads = useMemo(() => {
    if (view !== "priority" || !priorityRankedIds?.length) return threads;
    return sortThreadsByRank(threads, priorityRankedIds);
  }, [threads, view, priorityRankedIds]);

  useEffect(() => {
    setPriorityRankedIds(null);
  }, [inbox.dataUpdatedAt]);

  const handleViewChange = (nextView: InboxView) => {
    setView(nextView);
    if (nextView !== "priority") return;
    if (!aiReady) {
      toast.message("Add OPENAI_API_KEY to enable AI priority ranking.");
      return;
    }
    if (threads.length === 0) return;
    rankThreads.mutate({
      threads: threads.map((thread) => ({
        id: thread.id,
        snippet: thread.snippet,
        subject: thread.subject,
        from: thread.fromName ?? thread.from,
      })),
    });
  };

  const banner = useMemo(() => {
    const gmailConnected = searchParams.get("gmail") === "connected";
    const error = searchParams.get("error");
    if (gmailConnected) return { type: "success" as const, text: "Gmail connected successfully." };
    if (error) return { type: "error" as const, text: error };
    return null;
  }, [searchParams]);

  useEffect(() => {
    if (view === "drafts") return;
    if (!selectedId && visibleThreads.length > 0) {
      setSelectedId(visibleThreads[0]?.id ?? null);
    }
  }, [visibleThreads, selectedId, view]);

  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      void utils.inbox.connectionStatus.invalidate();
    }
  }, [searchParams, utils]);

  useEffect(() => {
    if (!selectedQuery.data) return;
    // Mark the thread as read when it's opened and it's currently unread.
    const thread = visibleThreads.find((t) => t.id === selectedId);
    if (thread?.unread && selectedId && isConnected) {
      markRead.mutate({ threadId: selectedId });
    }
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

  // Keyboard navigation: j/k move, Enter opens, / focuses search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (view === "drafts" || visibleThreads.length === 0) return;

      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const index = visibleThreads.findIndex((thread) => thread.id === selectedId);
        const delta = event.key === "j" ? 1 : -1;
        const nextIndex = Math.min(
          Math.max((index === -1 ? 0 : index) + delta, 0),
          visibleThreads.length - 1,
        );
        setSelectedId(visibleThreads[nextIndex]?.id ?? null);
      }
      // e = archive selected thread
      if (event.key === "e" && selectedId) {
        event.preventDefault();
        archiveThread.mutate({ threadId: selectedId });
      }
      // Escape = close reading pane on mobile
      if (event.key === "Escape" && selectedId) {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleThreads, selectedId, view, archiveThread]);

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

  const showThreadList = view !== "drafts";

  return (
    <div className="thread-inbox" data-selected={selectedId ? "true" : undefined}>
      <div className="thread-inbox-list">
        <div className="thread-inbox-list-head">
          <button
            type="button"
            className="thread-inbox-tab"
            data-active={view === "inbox"}
            onClick={() => setView("inbox")}
          >
            Inbox
          </button>
          <button
            type="button"
            className="thread-inbox-tab"
            data-active={view === "priority"}
            data-disabled={!aiReady ? "true" : undefined}
            onClick={() => handleViewChange("priority")}
            title={aiReady ? "Rank by urgency with OpenAI" : "Set OPENAI_API_KEY to enable"}
          >
            <Sparkles size={12} />
            Priority
          </button>
          <button
            type="button"
            className="thread-inbox-tab"
            data-active={view === "drafts"}
            onClick={() => setView("drafts")}
          >
            <FileText size={12} />
            Drafts
          </button>
          <Link
            href="/queue"
            className="thread-inbox-queue-link"
            aria-label={`Open approval queue${queueCount ? `, ${queueCount} pending` : ""}`}
          >
            <ListChecks size={14} />
            Queue
            {queueCount > 0 ? <span className="thread-inbox-queue-badge">{queueCount}</span> : null}
          </Link>
        </div>

        {isConnected && showThreadList ? (
          <div className="thread-inbox-search">
            <Search size={14} />
            <input
              ref={searchRef}
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search mail (from:, subject:, has:attachment…)"
              aria-label="Search mail"
            />
            {searchInput ? (
              <button
                type="button"
                className="thread-inbox-search-clear"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            ) : (
              <kbd className="thread-app-kbd">/</kbd>
            )}
          </div>
        ) : null}

        {view === "inbox" && isConnected && inbox.isRefreshing ? (
          <p
            style={{
              margin: "8px 12px 0",
              fontSize: 11,
              color: "var(--thread-dim)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Loader2 size={12} className="thread-spin" />
            Updating from Gmail…
          </p>
        ) : null}

        {view === "priority" && isConnected ? (
          <div className="thread-inbox-banner" style={{ margin: "10px 12px 0" }}>
            {rankThreads.isPending ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Loader2 size={14} className="thread-spin" />
                Ranking threads by urgency…
              </span>
            ) : aiReady ? (
              "Sorted by AI urgency — approve replies from Queue."
            ) : (
              "Priority ranking needs OPENAI_API_KEY in server env."
            )}
          </div>
        ) : null}

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
          ) : view === "drafts" ? (
            drafts.isLoading ? (
              <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
                <Loader2 size={18} className="thread-spin" />
                <p style={{ marginTop: 12, fontSize: 12, color: "var(--thread-dim)" }}>
                  Loading drafts…
                </p>
              </div>
            ) : drafts.drafts.length === 0 ? (
              <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
                <FileText size={20} style={{ opacity: 0.35 }} />
                <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--thread-muted)" }}>
                  No drafts
                </p>
                <p style={{ marginTop: 6, fontSize: 12, color: "var(--thread-dim)" }}>
                  Queue a draft from any thread — approve it to save into Gmail.
                </p>
              </div>
            ) : (
              <>
              {drafts.drafts.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  className="thread-inbox-row"
                  data-active={Boolean(draft.threadId) && selectedId === draft.threadId}
                  onClick={() => {
                    if (draft.threadId) {
                      setView("inbox");
                      setSelectedId(draft.threadId);
                    }
                  }}
                >
                  <span className="thread-inbox-row-line">
                    <span className="thread-inbox-row-sender">
                      {draft.to ? `To ${draft.to}` : "Draft"}
                    </span>
                    <span className="thread-inbox-row-date">{formatListDate(draft.updatedAt)}</span>
                  </span>
                  <span className="thread-inbox-row-subject">
                    {draft.subject?.trim() || "(no subject)"}
                  </span>
                  <span className="thread-inbox-row-snippet">{draft.snippet}</span>
                </button>
              ))}
              </>
            )
          ) : inbox.isLoading ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Loader2 size={18} className="thread-spin" />
              <p style={{ marginTop: 12, fontSize: 12, color: "var(--thread-dim)" }}>
                Loading threads…
              </p>
            </div>
          ) : visibleThreads.length === 0 ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Inbox size={20} style={{ opacity: 0.35 }} />
              <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--thread-muted)" }}>
                {appliedQuery ? "No matches" : "Inbox is empty"}
              </p>
              {appliedQuery ? (
                <p style={{ marginTop: 6, fontSize: 12, color: "var(--thread-dim)" }}>
                  Nothing matched “{appliedQuery}”.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              {visibleThreads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className="thread-inbox-row"
                  data-active={selectedId === thread.id}
                  data-unread={thread.unread ? "true" : undefined}
                  onClick={() => setSelectedId(thread.id)}
                >
                  <span className="thread-inbox-row-line">
                    <span className="thread-inbox-row-sender">
                      {thread.unread ? <span className="thread-inbox-row-dot" aria-hidden /> : null}
                      {thread.fromName?.trim() || thread.from?.trim() || "Unknown sender"}
                      {thread.messageCount && thread.messageCount > 1 ? (
                        <span className="thread-inbox-row-count">{thread.messageCount}</span>
                      ) : null}
                    </span>
                    <span className="thread-inbox-row-date">{formatListDate(thread.date)}</span>
                  </span>
                  <span className="thread-inbox-row-subject">
                    {listThreadSubject(thread.subject, thread.snippet)}
                  </span>
                  <span className="thread-inbox-row-snippet">{decodeHtmlEntities(thread.snippet)}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {isConnected && view === "inbox" && visibleThreads.length > 0 ? (
          <div className="thread-inbox-list-footer">
            {inbox.isRefreshing ? (
              <p className="thread-inbox-list-footer-hint">
                <Loader2 size={12} className="thread-spin" style={{ display: "inline", marginRight: 6 }} />
                Syncing from Gmail…
              </p>
            ) : inbox.nextPageToken ? (
              <button
                type="button"
                className="thread-inbox-loadmore"
                onClick={inbox.loadMore}
                disabled={inbox.isFetchingMore}
              >
                {inbox.isFetchingMore ? (
                  <>
                    <Loader2 size={13} className="thread-spin" /> Loading…
                  </>
                ) : (
                  "Load more mails"
                )}
              </button>
            ) : (
              <p className="thread-inbox-list-footer-hint">
                All caught up · {visibleThreads.length} shown{visibleThreads.length >= PAGE_SIZE ? " (scroll list above)" : ""}
              </p>
            )}
          </div>
        ) : null}

        {isConnected && view === "drafts" && drafts.drafts.length > 0 ? (
          <div className="thread-inbox-list-footer">
            {drafts.nextPageToken ? (
              <button
                type="button"
                className="thread-inbox-loadmore"
                onClick={drafts.loadMore}
                disabled={drafts.isFetchingMore}
              >
                {drafts.isFetchingMore ? (
                  <>
                    <Loader2 size={13} className="thread-spin" /> Loading…
                  </>
                ) : (
                  "Load more drafts"
                )}
              </button>
            ) : (
              <p className="thread-inbox-list-footer-hint">All drafts loaded</p>
            )}
          </div>
        ) : null}
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
            <button
              type="button"
              className="thread-inbox-back-btn"
              onClick={() => setSelectedId(null)}
            >
              ← Back
            </button>
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
                <button
                  type="button"
                  className="thread-btn-ghost"
                  style={{ fontSize: 12, padding: "7px 12px", flexShrink: 0 }}
                  disabled={archiveThread.isPending}
                  onClick={() => selectedId && archiveThread.mutate({ threadId: selectedId })}
                  title="Archive thread (remove from inbox)"
                >
                  <Archive size={14} />
                  {archiveThread.isPending ? "Archiving…" : "Archive"}
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
                        <>
                          <EmailMessageBody
                            bodyHtml={message.bodyHtml}
                            body={message.body}
                            snippet={message.snippet}
                          />
                          {message.attachments && message.attachments.length > 0 ? (
                            <div className="thread-inbox-attachments">
                              <p className="thread-inbox-attachments-label">
                                <FileText size={12} />
                                {message.attachments.length === 1
                                  ? "1 attachment"
                                  : `${message.attachments.length} attachments`}
                              </p>
                              <ul className="thread-inbox-attachment-list">
                                {message.attachments.map((att) => (
                                  <li key={att.attachmentId ?? att.filename} className="thread-inbox-attachment-item">
                                    <FileText size={12} />
                                    <span className="thread-inbox-attachment-name">{att.filename}</span>
                                    {att.size > 0 ? (
                                      <span className="thread-inbox-attachment-size">
                                        {att.size < 1024
                                          ? `${att.size} B`
                                          : att.size < 1024 * 1024
                                            ? `${Math.round(att.size / 1024)} KB`
                                            : `${(att.size / (1024 * 1024)).toFixed(1)} MB`}
                                      </span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <EmailMessageBody
                  bodyHtml={selectedQuery.data.messages?.[selectedQuery.data.messages.length - 1]?.bodyHtml}
                  body={selectedQuery.data.body}
                  snippet={selectedQuery.data.snippet}
                  className="thread-inbox-message-body"
                />
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
                  <span className="thread-inbox-reply-hint"> — replying based on selected message</span>
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
              </div>
              <p className="thread-inbox-compose-note">
                Approve queued actions from <Link href="/queue">Queue</Link>. Nothing sends until you
                approve.
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
              <button type="button" className="thread-app-iconbtn" onClick={() => setShowSchedule(false)}>
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
                <button type="button" className="thread-btn-ghost" onClick={() => setShowSchedule(false)}>
                  Cancel
                </button>
                <button type="submit" className="thread-btn-accent" disabled={queueMeeting.isPending}>
                  <ListChecks size={14} />
                  {queueMeeting.isPending ? "Queuing…" : "Queue invite + email"}
                </button>
              </div>
              <p className="thread-inbox-compose-note" style={{ margin: 0 }}>
                Goes to the approval queue first. After you approve, it appears on Calendar for the date
                you picked.
              </p>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
