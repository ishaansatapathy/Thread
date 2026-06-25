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
  Tag,
  CalendarPlus,
  ListChecks,
  X,
  Search,
  Sparkles,
  PanelRight,
  Star,
  Zap,
  Trash2,
  BellOff,
  CheckSquare,
  Paperclip,
  Clock,
  RefreshCw,
  ExternalLink,
} from "lucide-react";

import { SmartContextPanel } from "~/components/app/smart-context-panel";
import { PriorityBadge } from "~/components/app/priority-badge";
import { formatPrioritySummary } from "~/lib/priority-display";
import { DEMO_AI_HIGHLIGHTS } from "~/lib/demo-fixtures";
import { useDemoAiGuard } from "~/components/app/demo-limit-modal";
import { isDemoLoginEnabled } from "~/lib/demo-config";

import { SenderAvatar } from "~/components/app/sender-avatar";
import { SkeletonList } from "~/components/app/skeleton-list";
import { QueryErrorState } from "~/components/app/query-error-state";
import { EmailMessageBody } from "~/components/app/email-message-body";
import { queueResultMessage } from "~/lib/queue-toast";
import { dismissBriefThreadFromQueueItem } from "~/lib/brief-dismissals";
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

function threadLikelyHasAttachment(thread: { snippet?: string; subject?: string }) {
  const text = `${thread.subject ?? ""} ${thread.snippet ?? ""}`.toLowerCase();
  return (
    text.includes("attachment") ||
    /\b(pdf|docx|xlsx|pptx|zip|png|jpe?g)\b/.test(text) ||
    /has attached|attached file|sent you a file/.test(text)
  );
}

type InboxView = "inbox" | "priority" | "drafts";
type ThreadRow = RouterOutputs["inbox"]["listThreads"]["threads"][number];
type InboxAnalysis = RouterOutputs["ai"]["rankInboxThreads"];

const PAGE_SIZE = INBOX_PAGE_SIZE;

type OutboundAttachment = {
  filename: string;
  mimeType: string;
  contentBase64: string;
};

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1]! : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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
    {
      enabled,
      refetchInterval: enabled && isFirstPage ? 15_000 : false,
      placeholderData: (prev) => prev,
    },
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
    isError: result.isError && threads.length === 0,
    error: result.error,
    refetch: result.refetch,
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
    isError: result.isError && pages.length === 0,
    error: result.error,
    refetch: result.refetch,
    isFetchingMore: result.isFetching && pageToken !== undefined,
  };
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<InboxView>("inbox");
  const [priorityAnalysis, setPriorityAnalysis] = useState<InboxAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [dbSearchMode, setDbSearchMode] = useState(false);
  const [mutedThreadIds, setMutedThreadIds] = useState<Set<string>>(() => new Set());
  const priorityBootstrapped = useRef(false);
  const lastRankedKeyRef = useRef("");
  const [replyTo, setReplyTo] = useState("");
  const [replySubjectValue, setReplySubjectValue] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyCc, setReplyCc] = useState("");
  const [replyBcc, setReplyBcc] = useState("");
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
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const labelPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showLabelPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (labelPickerRef.current && !labelPickerRef.current.contains(e.target as Node)) {
        setShowLabelPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showLabelPicker]);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [outboundAttachments, setOutboundAttachments] = useState<OutboundAttachment[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Snooze (localStorage) ──────────────────────────────────────────────────
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("thread-snoozed");
      if (!raw) return new Set();
      const entries: Array<{ id: string; until: number }> = JSON.parse(raw);
      const now = Date.now();
      const still = entries.filter((e) => e.until > now);
      if (still.length !== entries.length) {
        localStorage.setItem("thread-snoozed", JSON.stringify(still));
      }
      return new Set(still.map((e) => e.id));
    } catch { return new Set(); }
  });

  const snoozeThread = useCallback((threadId: string, when: "tomorrow" | "nextweek" | "custom", customMs?: number) => {
    const now = Date.now();
    const ms = when === "tomorrow"
      ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime() - now; })()
      : when === "nextweek"
        ? (() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(8, 0, 0, 0); return d.getTime() - now; })()
        : (customMs ?? 86_400_000);
    const until = now + ms;
    setSnoozedIds((prev) => {
      const next = new Set(prev);
      next.add(threadId);
      try {
        const raw = localStorage.getItem("thread-snoozed");
        const existing: Array<{ id: string; until: number }> = raw ? JSON.parse(raw) : [];
        const filtered = existing.filter((e) => e.id !== threadId);
        filtered.push({ id: threadId, until });
        localStorage.setItem("thread-snoozed", JSON.stringify(filtered));
      } catch { /* noop */ }
      return next;
    });
    if (selectedId === threadId) setSelectedId(null);
    const wakeLabel = when === "tomorrow" ? "tomorrow at 8am" : when === "nextweek" ? "next week" : "later";
    toast.success(`Snoozed until ${wakeLabel}`, {
      action: { label: "Undo", onClick: () => unsnoozeThread(threadId) },
    });
  }, [selectedId]);

  const unsnoozeThread = useCallback((threadId: string) => {
    setSnoozedIds((prev) => {
      const next = new Set(prev);
      next.delete(threadId);
      try {
        const raw = localStorage.getItem("thread-snoozed");
        const existing: Array<{ id: string; until: number }> = raw ? JSON.parse(raw) : [];
        localStorage.setItem("thread-snoozed", JSON.stringify(existing.filter((e) => e.id !== threadId)));
      } catch { /* noop */ }
      return next;
    });
  }, []);

  // ── Bulk select ────────────────────────────────────────────────────────────
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  const toggleBulk = useCallback((id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearBulk = useCallback(() => {
    setBulkMode(false);
    setBulkSelected(new Set());
  }, []);

  const utils = trpc.useUtils();

  const bulkArchive = useCallback(async () => {
    const ids = [...bulkSelected];
    clearBulk();
    await utils.client.inbox.batchModifyThreads.mutate({
      threadIds: ids,
      removeLabelIds: ["INBOX"],
    });
    toast.success(`${ids.length} thread${ids.length === 1 ? "" : "s"} archived`);
    await utils.inbox.listThreads.invalidate();
  }, [bulkSelected, clearBulk, utils]);

  const bulkMarkRead = useCallback(async () => {
    const ids = [...bulkSelected];
    clearBulk();
    await utils.client.inbox.batchModifyThreads.mutate({
      threadIds: ids,
      removeLabelIds: ["UNREAD"],
    });
    toast.success(`${ids.length} thread${ids.length === 1 ? "" : "s"} marked read`);
    await utils.inbox.listThreads.invalidate();
  }, [bulkSelected, clearBulk, utils]);

  const bulkSnooze = useCallback(() => {
    for (const id of bulkSelected) snoozeThread(id, "tomorrow");
    toast.dismiss();
    toast.success(`${bulkSelected.size} thread${bulkSelected.size === 1 ? "" : "s"} snoozed until tomorrow`);
    clearBulk();
  }, [bulkSelected, snoozeThread, clearBulk]);

  const bulkStar = useCallback(async () => {
    const ids = [...bulkSelected];
    clearBulk();
    await utils.client.inbox.batchModifyThreads.mutate({
      threadIds: ids,
      addLabelIds: ["STARRED"],
    });
    toast.success(`${ids.length} thread${ids.length === 1 ? "" : "s"} starred`);
    await utils.inbox.listThreads.invalidate();
  }, [bulkSelected, clearBulk, utils]);

  const bulkTrash = useCallback(async () => {
    const ids = [...bulkSelected];
    clearBulk();
    await Promise.all(ids.map((id) => utils.client.inbox.trashThread.mutate({ threadId: id })));
    toast.success(`${ids.length} thread${ids.length === 1 ? "" : "s"} moved to trash`);
    await utils.inbox.listThreads.invalidate();
  }, [bulkSelected, clearBulk, utils]);
  const meQuery = trpc.auth.me.useQuery({});
  const userEmail = meQuery.data?.email;
  const userPhotoUrl = meQuery.data?.profileImageUrl;
  const statusQuery = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});
  const pendingCount = trpc.queue.pendingCount.useQuery({});
  const aiStatus = trpc.ai.status.useQuery({});
  const aiReady = aiStatus.data?.openai === true;

  const isConnected = statusQuery.data?.gmail === "connected";
  const { isDemo: isDemoUser, tryFeature: tryMailDemo, modal: mailDemoModal, featureState: mailDemoState } =
    useDemoAiGuard(userEmail, "mail");
  const [demoSummarizeEnabled, setDemoSummarizeEnabled] = useState(false);
  const demoCacheQuery = trpc.inbox.listCachedThreads.useQuery({ limit: 50 }, { staleTime: 120_000 });
  const hasDemoFixtures =
    isDemoLoginEnabled() && !isConnected && (demoCacheQuery.data?.threads.length ?? 0) > 0;
  const canBrowseInbox = isConnected || hasDemoFixtures;

  const approveQueueItem = trpc.queue.approve.useMutation({
    onSuccess: async () => {
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      toast.success("Approved and sent");
    },
    onError: (error) => toast.error(error.message),
  });

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
    onError: (error) => toast.error(error.message),
  });

  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [importantIds, setImportantIds] = useState<Set<string>>(new Set());

  const starThread = trpc.inbox.starThread.useMutation({
    onSuccess: () => { if (selectedId) setStarredIds((s) => new Set([...s, selectedId])); },
    onError: (e) => toast.error(e.message),
  });
  const unstarThread = trpc.inbox.unstarThread.useMutation({
    onSuccess: () => { if (selectedId) setStarredIds((s) => { const n = new Set(s); n.delete(selectedId); return n; }); },
    onError: (e) => toast.error(e.message),
  });
  const markImportant = trpc.inbox.markImportant.useMutation({
    onSuccess: () => { if (selectedId) setImportantIds((s) => new Set([...s, selectedId])); toast.success("Marked as important"); },
    onError: (e) => toast.error(e.message),
  });
  const markNotImportant = trpc.inbox.markNotImportant.useMutation({
    onSuccess: () => { if (selectedId) setImportantIds((s) => { const n = new Set(s); n.delete(selectedId); return n; }); },
    onError: (e) => toast.error(e.message),
  });
  const trashThread = trpc.inbox.trashThread.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Moved to trash");
      utils.inbox.listThreads.setData(
        { maxResults: PAGE_SIZE, query: appliedQuery || undefined },
        (old) => {
          if (!old) return old;
          return { ...old, threads: old.threads.filter((t) => t.id !== variables.threadId) };
        }
      );
      setSelectedId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const muteThread = trpc.inbox.muteThread.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Thread muted");
      setMutedThreadIds((prev) => new Set(prev).add(variables.threadId));
      utils.inbox.listThreads.setData(
        { maxResults: PAGE_SIZE, query: appliedQuery || undefined },
        (old) => {
          if (!old) return old;
          return { ...old, threads: old.threads.filter((t) => t.id !== variables.threadId) };
        }
      );
      setSelectedId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const unmuteThread = trpc.inbox.unmuteThread.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Thread unmuted");
      setMutedThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(variables.threadId);
        return next;
      });
      void utils.inbox.listThreads.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendDraft = trpc.queue.enqueueDraftSend.useMutation({
    onSuccess: async (item) => {
      toast.success(queueResultMessage(item).title);
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      await utils.inbox.listDrafts.invalidate();
    },
    onError: (e) => toast.error(e.message),
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

  const labelsQuery = trpc.inbox.listLabels.useQuery({}, {
    staleTime: 5 * 60_000,
    enabled: isConnected,
  });

  const applyLabel = trpc.inbox.applyLabel.useMutation({
    onSuccess: () => toast.success("Label applied"),
    onError: (e) => toast.error(e.message),
  });

  const removeLabel = trpc.inbox.removeLabel.useMutation({
    onSuccess: () => toast.success("Label removed"),
    onError: (e) => toast.error(e.message),
  });

  const createLabel = trpc.inbox.createLabel.useMutation({
    onSuccess: async (label) => {
      toast.success(`Label "${label.name}" created`);
      setNewLabelName("");
      await utils.inbox.listLabels.invalidate();
      if (selectedId) applyLabel.mutate({ threadId: selectedId, labelId: label.id });
      setShowLabelPicker(false);
    },
    onError: (e) => toast.error(e.message),
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
    if (searchParams.get("compose") === "1") {
      setView("inbox");
      setShowCompose(true);
    }
    const threadId = searchParams.get("thread");
    if (threadId) {
      setView("inbox");
      setSelectedId(threadId);
    }
  }, [searchParams]);

  const effectiveQuery = useMemo(() => {
    const parts: string[] = [];
    if (appliedQuery) parts.push(appliedQuery);
    if (labelFilter) {
      const label = labelsQuery.data?.find((entry) => entry.id === labelFilter);
      if (label?.name) {
        parts.push(label.name.includes(" ") ? `label:"${label.name}"` : `label:${label.name}`);
      }
    }
    return parts.join(" ").trim();
  }, [appliedQuery, labelFilter, labelsQuery.data]);

  const inbox = useInboxThreads(effectiveQuery, isConnected && !dbSearchMode);
  const dbSearch = trpc.inbox.searchThreadsDb.useQuery(
    { query: appliedQuery || undefined, limit: PAGE_SIZE },
    { enabled: isConnected && dbSearchMode && view === "inbox", staleTime: 30_000 },
  );
  const threads = dbSearchMode && view === "inbox" ? (dbSearch.data?.threads ?? []) : inbox.threads;

  const displayThreads = hasDemoFixtures ? (demoCacheQuery.data?.threads ?? []) : threads;

  const drafts = useDrafts(isConnected && view === "drafts");

  const selectedQuery = trpc.inbox.getThread.useQuery(
    { threadId: selectedId ?? "" },
    { enabled: Boolean(selectedId) && (isConnected || hasDemoFixtures) },
  );

  // Detect meeting invites in the selected thread and search for the matching
  // calendar event so we can RSVP with the real Google Calendar event ID.
  const rsvpIsInvite = useMemo(() => {
    const msgs = selectedQuery.data?.messages ?? [];
    const allText = msgs.map((m) => (m.body ?? "") + (m.snippet ?? "")).join(" ");
    return /you.?re? invited|calendar invite|rsvp|join.*meeting|google meet|zoom\.us\/j\//i.test(allText);
  }, [selectedQuery.data?.messages]);

  const rsvpSearchTerm = useMemo(() => {
    if (!selectedQuery.data?.subject) return "";
    return selectedQuery.data.subject.replace(/^(Re|Fwd|FW|RE|FWD):\s*/i, "").trim();
  }, [selectedQuery.data?.subject]);

  const selectedAttachmentCount = useMemo(() => {
    const msgs = selectedQuery.data?.messages ?? [];
    return msgs.reduce((sum, m) => sum + (m.attachments?.length ?? 0), 0);
  }, [selectedQuery.data?.messages]);

  // Stable time range computed once — events in the next 45 days.
  const rsvpTimeRange = useMemo(() => ({
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selectedId]); // re-compute when thread changes, not on every render

  const rsvpEventQuery = trpc.calendar.listEvents.useQuery(
    { ...rsvpTimeRange, q: rsvpSearchTerm, maxResults: 5 },
    {
      enabled: Boolean(rsvpIsInvite && rsvpSearchTerm && calendarStatus.data?.googlecalendar === "connected"),
      staleTime: 60_000,
    },
  );

  const rsvpEvent = rsvpEventQuery.data?.events[0] ?? null;

  const queueEmail = trpc.queue.enqueueEmail.useMutation({
    onSuccess: async (item) => {
      dismissBriefThreadFromQueueItem(item);
      await utils.queue.pendingCount.invalidate();
      await utils.ai.dailyBrief.invalidate();
      const msg = queueResultMessage(item);
      if (item.status === "pending") {
        toast.success(msg.title, {
          action: {
            label: "Approve",
            onClick: () => approveQueueItem.mutate({ id: item.id }),
          },
        });
      } else {
        toast.success(msg.title);
      }
      setReplyBody("");
      setReplyCc("");
      setReplyBcc("");
      setShowCompose(false);
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject("");
      setComposeBody("");
      setOutboundAttachments([]);
    },
    onError: (error) => toast.error(error.message),
  });

  const rankThreads = trpc.ai.rankInboxThreads.useMutation({
    onSuccess: (result) => {
      setPriorityAnalysis(result);
    },
    onError: (error) => toast.error(error.message),
  });

  const refreshPriorityRank = useCallback(
    async (opts?: { force?: boolean; query?: string }) => {
      if (!isConnected || !aiReady) return;
      try {
        const defaultRankQuery = [
          effectiveQuery,
          "-category:promotions -category:social -category:forums",
        ]
          .filter(Boolean)
          .join(" ");
        const rankQuery = opts?.query ?? (defaultRankQuery || undefined);
        const batch = await utils.client.inbox.listThreads.query({
          maxResults: 50,
          query: rankQuery,
          refresh: opts?.force ?? true,
        });
        if (batch.threads.length === 0) {
          setPriorityAnalysis(null);
          lastRankedKeyRef.current = "";
          return;
        }
        const slice = batch.threads.slice(0, 40);
        const key = slice.map((thread) => thread.id).join(",");
        if (!opts?.force && key === lastRankedKeyRef.current && priorityAnalysis) return;
        lastRankedKeyRef.current = key;
        rankThreads.mutate({
          threads: slice.map((thread) => ({
            id: thread.id,
            snippet: thread.snippet,
            subject: thread.subject,
            from: thread.fromName ?? thread.from,
          })),
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load threads for ranking");
      }
    },
    [aiReady, effectiveQuery, isConnected, priorityAnalysis, rankThreads, utils.client.inbox.listThreads],
  );

  const priorityByThreadId = useMemo(() => {
    const map = new Map<string, InboxAnalysis["items"][number]>();
    for (const item of priorityAnalysis?.items ?? []) {
      map.set(item.id, item);
    }
    return map;
  }, [priorityAnalysis]);

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

  useEffect(() => {
    if (!isConnected || !aiReady || priorityBootstrapped.current) return;
    priorityBootstrapped.current = true;
    void refreshPriorityRank({ force: true });
  }, [isConnected, aiReady, refreshPriorityRank]);

  const smartRepliesQuery = trpc.ai.smartReplies.useQuery(
    { threadId: selectedId ?? "" },
    {
      enabled: Boolean(selectedId) && aiReady && (isConnected || demoSummarizeEnabled),
      staleTime: 2 * 60_000,
    },
  );

  const summarizeQuery = trpc.ai.summarizeThread.useQuery(
    { threadId: selectedId ?? "" },
    {
      enabled: Boolean(selectedId) && aiReady && (isConnected || demoSummarizeEnabled),
      staleTime: 5 * 60_000,
    },
  );

  const visibleThreads = useMemo(() => {
    const source = hasDemoFixtures ? displayThreads : threads;
    if (view !== "priority") return source;

    const rankedIds = priorityAnalysis?.rankedIds;
    if (!rankedIds?.length) return [];
    const rankedSet = new Set(rankedIds);
    const filtered = source.filter((t) => {
      if (!rankedSet.has(t.id)) return false;
      const item = priorityByThreadId.get(t.id);
      return item?.urgency !== "noise";
    });
    return sortThreadsByRank(filtered, rankedIds);
  }, [threads, displayThreads, hasDemoFixtures, view, priorityAnalysis, priorityByThreadId]);

  const priorityVisibleCount = useMemo(() => {
    if (!priorityAnalysis) return 0;
    return priorityAnalysis.items.filter((item) => item.urgency !== "noise").length;
  }, [priorityAnalysis]);

  const priorityRanking = rankThreads.isPending;
  const priorityReady = Boolean(priorityAnalysis?.rankedIds?.length);

  // If user is on Priority but analysis is missing, re-fetch (e.g. after navigation).
  useEffect(() => {
    if (view !== "priority" || priorityReady || priorityRanking || !isConnected || !aiReady) return;
    void refreshPriorityRank({ force: true });
  }, [view, priorityReady, priorityRanking, isConnected, aiReady, refreshPriorityRank]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  // Keep latest action fns in a ref so the keydown listener never needs to be
  // torn down and re-registered when mutation state (isPending, etc.) changes.
  const kbdRef = useRef({
    archiveMutate: archiveThread.mutate,
    markReadMutate: markRead.mutate,
    starMutate: starThread.mutate,
    unstarMutate: unstarThread.mutate,
    trashMutate: trashThread.mutate,
    snoozeThread,
    clearBulk,
    starredIds,
    snoozedIds,
    visibleThreads,
    selectedId,
    bulkMode,
  });
  useEffect(() => {
    kbdRef.current = {
      archiveMutate: archiveThread.mutate,
      markReadMutate: markRead.mutate,
      starMutate: starThread.mutate,
      unstarMutate: unstarThread.mutate,
      trashMutate: trashThread.mutate,
      snoozeThread,
      clearBulk,
      starredIds,
      snoozedIds,
      visibleThreads,
      selectedId,
      bulkMode,
    };
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const r = kbdRef.current;
      const tag = (e.target as HTMLElement).tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;
      if (e.key === "Escape") {
        if (r.bulkMode) { r.clearBulk(); return; }
        if (r.selectedId) { setSelectedId(null); return; }
        setSearchInput("");
        return;
      }
      if (isEditing) return;

      if (e.key === "/" && !isEditing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "e" && r.selectedId) {
        r.archiveMutate({ threadId: r.selectedId });
        setSelectedId(null);
        return;
      }
      if (e.key === "u" && r.selectedId) {
        r.markReadMutate({ threadId: r.selectedId });
        return;
      }
      if (e.key === "s" && r.selectedId) {
        r.starredIds.has(r.selectedId)
          ? r.unstarMutate({ threadId: r.selectedId })
          : r.starMutate({ threadId: r.selectedId });
        return;
      }
      if (e.key === "b" && r.selectedId) {
        r.snoozeThread(r.selectedId, "tomorrow");
        return;
      }
      if (e.key === "#" && r.selectedId) {
        r.trashMutate({ threadId: r.selectedId });
        setSelectedId(null);
        return;
      }
      if (e.key === "x" && !r.selectedId) {
        setBulkMode((v) => { if (v) r.clearBulk(); return !v; });
        return;
      }
      if ((e.key === "j" || e.key === "ArrowDown") && !r.selectedId) {
        const idx = r.visibleThreads.findIndex((t) => !r.snoozedIds.has(t.id));
        if (idx >= 0) setSelectedId(r.visibleThreads[idx]!.id);
        return;
      }
      if ((e.key === "j" || e.key === "ArrowDown") && r.selectedId) {
        const idx = r.visibleThreads.findIndex((t) => t.id === r.selectedId && !r.snoozedIds.has(t.id));
        const next = r.visibleThreads.slice(idx + 1).find((t) => !r.snoozedIds.has(t.id));
        if (next) setSelectedId(next.id);
        return;
      }
      if ((e.key === "k" || e.key === "ArrowUp") && r.selectedId) {
        const idx = r.visibleThreads.findIndex((t) => t.id === r.selectedId);
        const prev = [...r.visibleThreads].slice(0, idx).reverse().find((t) => !r.snoozedIds.has(t.id));
        if (prev) setSelectedId(prev.id);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // registered once — reads latest state from kbdRef

  const handleViewChange = (nextView: InboxView) => {
    setView(nextView);
    if (nextView !== "priority") return;
    if (hasDemoFixtures && !isConnected) return;
    if (!aiReady) {
      toast.message("Add OPENAI_API_KEY to enable AI priority ranking.");
      return;
    }
    if (!priorityAnalysis?.rankedIds?.length && !rankThreads.isPending) {
      void refreshPriorityRank({ force: true });
    }
  };

  const handlePriorityRefresh = () => {
    if (!aiReady) {
      toast.message("Add OPENAI_API_KEY to enable AI priority ranking.");
      return;
    }
    void refreshPriorityRank({ force: true });
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
    // Initialize star/important state from Gmail labelIds (via Corsair)
    if (selectedId && selectedQuery.data.labelIds) {
      if (selectedQuery.data.labelIds.includes("STARRED")) {
        setStarredIds((s) => new Set([...s, selectedId]));
      } else {
        setStarredIds((s) => { const n = new Set(s); n.delete(selectedId); return n; });
      }
      if (selectedQuery.data.labelIds.includes("IMPORTANT")) {
        setImportantIds((s) => new Set([...s, selectedId]));
      } else {
        setImportantIds((s) => { const n = new Set(s); n.delete(selectedId); return n; });
      }
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
    setReplyBody("");
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
      if (event.key === "Enter") {
        event.preventDefault();
        if (!selectedId && visibleThreads[0]) {
          setSelectedId(visibleThreads[0].id);
        }
        return;
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

  useEffect(() => {
    setDemoSummarizeEnabled(false);
  }, [selectedId]);

  const connectHref = `/api-connect/gmail?state=${encodeURIComponent("/inbox")}`;
  const queueCount = pendingCount.data?.count ?? 0;

  const emailPayload = {
    to: replyTo,
    cc: replyCc.trim() || undefined,
    bcc: replyBcc.trim() || undefined,
    subject: replySubjectValue,
    body: replyBody,
    threadId: selectedQuery.data?.id,
    attachments: outboundAttachments.length ? outboundAttachments : undefined,
  };

  const pickAttachments = async (files: FileList | null) => {
    if (!files) return;
    const next = [...outboundAttachments];
    for (const file of Array.from(files).slice(0, Math.max(0, 5 - next.length))) {
      const contentBase64 = await fileToBase64(file);
      next.push({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
      });
    }
    setOutboundAttachments(next);
  };

  const showThreadList = view !== "drafts";

  return (
    <div className="thread-inbox" data-selected={selectedId ? "true" : undefined}>
      <div className="thread-inbox-list">
        {/* Single header row: tabs + compose + bulk toggle */}
        <div className="thread-inbox-list-head">
          <div className="thread-inbox-list-head-tabs">
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
              onClick={() => handleViewChange("priority")}
              title={aiReady ? "Rank by urgency with OpenAI" : "Set OPENAI_API_KEY to enable"}
            >
              <Sparkles size={11} />
              Priority
              {priorityVisibleCount > 0 ? (
                <span className="thread-inbox-tab-badge">{priorityVisibleCount}</span>
              ) : null}
            </button>
            <button
              type="button"
              className="thread-inbox-tab"
              data-active={view === "drafts"}
              onClick={() => setView("drafts")}
            >
              Drafts
            </button>
          </div>
          <div className="thread-inbox-list-head-actions">
            {isConnected ? (
              <>
                {view === "priority" && aiReady ? (
                  <button
                    type="button"
                    className="thread-inbox-priority-refresh-btn"
                    onClick={handlePriorityRefresh}
                    disabled={rankThreads.isPending}
                    title="Re-analyze inbox priority"
                  >
                    <RefreshCw size={13} className={rankThreads.isPending ? "thread-spin" : undefined} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`thread-inbox-bulk-btn${bulkMode ? " thread-inbox-bulk-btn--active" : ""}`}
                  onClick={() => { setBulkMode((v) => { if (v) clearBulk(); return !v; }); }}
                  title="Multi-select (x)"
                >
                  <CheckSquare size={13} />
                </button>
                <button
                  type="button"
                  className="thread-inbox-compose-icon-btn"
                  onClick={() => setShowCompose(true)}
                  title="Compose new email"
                >
                  <FilePenLine size={14} />
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Bulk action bar */}
        {bulkMode && bulkSelected.size > 0 ? (
          <div className="thread-inbox-bulk-bar">
            <span className="thread-inbox-bulk-count">{bulkSelected.size} selected</span>
            <button type="button" className="thread-inbox-bulk-action" onClick={() => void bulkArchive()}>
              <Archive size={11} /> Archive
            </button>
            <button type="button" className="thread-inbox-bulk-action" onClick={() => void bulkMarkRead()}>
              <Mail size={11} /> Mark read
            </button>
            <button type="button" className="thread-inbox-bulk-action" onClick={() => void bulkStar()}>
              <Star size={11} /> Star
            </button>
            <button type="button" className="thread-inbox-bulk-action" onClick={bulkSnooze}>
              <BellOff size={11} /> Snooze
            </button>
            <button type="button" className="thread-inbox-bulk-action" onClick={() => void bulkTrash()}>
              <Trash2 size={11} /> Trash
            </button>
            <button type="button" className="thread-inbox-bulk-action thread-inbox-bulk-action--cancel" onClick={clearBulk}>
              <X size={11} /> Cancel
            </button>
          </div>
        ) : bulkMode ? (
          <div className="thread-inbox-bulk-bar">
            <span className="thread-inbox-bulk-count" style={{ color: "var(--thread-dim)" }}>Select threads…</span>
            <button type="button" className="thread-inbox-bulk-action thread-inbox-bulk-action--cancel" onClick={clearBulk}>
              <X size={11} /> Cancel
            </button>
          </div>
        ) : null}

        {/* Search bar */}
        {isConnected && showThreadList ? (
          <div className="thread-inbox-search">
            <Search size={13} />
            <input
              ref={searchRef}
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={
                dbSearchMode
                  ? "Corsair DB search (local cache, sub-second)…"
                  : "Search mail (from:, subject:, has:attachment…)"
              }
              aria-label="Search mail"
            />
            <button
              type="button"
              className={`thread-inbox-db-toggle${appliedQuery === "has:attachment" ? " thread-inbox-db-toggle--active" : ""}`}
              onClick={() => {
                if (appliedQuery === "has:attachment") {
                  setSearchInput("");
                  setAppliedQuery("");
                } else {
                  setSearchInput("has:attachment");
                  setAppliedQuery("has:attachment");
                }
              }}
              title="Filter threads with attachments (Gmail has:attachment)"
            >
              <Paperclip size={12} />
            </button>
            <button
              type="button"
              className={`thread-inbox-db-toggle${dbSearchMode ? " thread-inbox-db-toggle--active" : ""}`}
              onClick={() => setDbSearchMode((v) => !v)}
              title="Toggle Corsair DB search (fast local cache)"
            >
              DB
            </button>
            {searchInput ? (
              <button
                type="button"
                className="thread-inbox-search-clear"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            ) : (
              <kbd className="thread-app-kbd">/</kbd>
            )}
          </div>
        ) : null}

        {/* Label filter */}
        {isConnected && showThreadList && labelsQuery.data && labelsQuery.data.length > 0 ? (
          <div className="thread-inbox-label-filter-row">
            <Tag size={11} />
            <select
              value={labelFilter}
              onChange={(event) => setLabelFilter(event.target.value)}
              aria-label="Filter by label"
            >
              <option value="">All labels</option>
              {labelsQuery.data
                .filter((l) => l.type !== "system" || ["STARRED", "IMPORTANT"].includes(l.id))
                .slice(0, 20)
                .map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
            </select>
          </div>
        ) : null}

        {view === "priority" && isConnected ? (
          <div className="thread-priority-summary">
            {rankThreads.isPending ? (
              <span className="thread-priority-summary-loading">
                <Loader2 size={13} className="thread-spin" />
                Analyzing inbox…
              </span>
            ) : priorityAnalysis ? (
              <span className="thread-priority-summary-head">
                <Sparkles size={12} style={{ color: "var(--thread-accent-bright)", flexShrink: 0 }} />
                <span>{formatPrioritySummary(priorityAnalysis.summary)}</span>
              </span>
            ) : aiReady ? null : (
              <span className="thread-priority-summary-meta">Priority needs OPENAI_API_KEY in server env.</span>
            )}
          </div>
        ) : null}

        {hasDemoFixtures ? (
          <div className="thread-demo-inbox-strip" style={{ margin: "10px 12px 0" }}>
            <Sparkles size={13} />
            <span>Demo inbox — {demoCacheQuery.data?.threads.length ?? 0} sample threads</span>
            <span className="thread-demo-inbox-strip-sep">·</span>
            <Link href="/brief" className="thread-demo-inbox-strip-link">Brief</Link>
            <Link href="/agent" className="thread-demo-inbox-strip-link">Agent</Link>
            <Link href="/queue" className="thread-demo-inbox-strip-link">Queue</Link>
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
          ) : !canBrowseInbox ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Inbox size={20} style={{ opacity: 0.35 }} />
              <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--thread-muted)" }}>
                No threads yet
              </p>
              <p style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--thread-dim)" }}>
                Connect Gmail via Corsair to sync your inbox here, or use demo login for sample threads.
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
              <SkeletonList count={6} />
            ) : drafts.isError ? (
              <QueryErrorState
                title="Couldn't load drafts"
                message={drafts.error?.message}
                onRetry={() => void drafts.refetch()}
                className="thread-empty-inbox"
              />
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
                <div key={draft.id} className="thread-inbox-row" style={{ display: "block", padding: 0 }}>
                  <button
                    type="button"
                    className="thread-inbox-row"
                    style={{ width: "100%", border: "none", background: "transparent" }}
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
                  <div style={{ display: "flex", gap: 6, padding: "0 12px 10px" }}>
                    <button
                      type="button"
                      className="thread-btn-ghost"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      onClick={async () => {
                        setComposeTo(draft.to ?? "");
                        setComposeSubject(draft.subject ?? "");
                        setComposeBody(draft.snippet ?? "");
                        try {
                          const full = await utils.client.inbox.getDraft.query({ draftId: draft.id });
                          if (full?.body) setComposeBody(full.body);
                          if (full?.subject) setComposeSubject(full.subject);
                          if (full?.to) setComposeTo(full.to);
                        } catch {
                          // fall back to snippet metadata
                        }
                        setOutboundAttachments([]);
                        setShowCompose(true);
                        setView("inbox");
                      }}
                    >
                      Edit in compose
                    </button>
                    <button
                      type="button"
                      className="thread-btn-accent"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      disabled={sendDraft.isPending}
                      onClick={() => sendDraft.mutate({ draftId: draft.id })}
                      title="Send this draft now"
                    >
                      {sendDraft.isPending ? "Sending…" : "Send"}
                    </button>
                    {draft.threadId ? (
                      <button
                        type="button"
                        className="thread-btn-ghost"
                        style={{ fontSize: 11, padding: "4px 8px" }}
                        onClick={() => {
                          setView("inbox");
                          setSelectedId(draft.threadId!);
                        }}
                      >
                        Open thread
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              </>
            )
          ) : view === "priority" && hasDemoFixtures && !isConnected ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Sparkles size={20} style={{ opacity: 0.35 }} />
              <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--thread-muted)" }}>
                Priority needs Gmail
              </p>
              <p style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--thread-dim)" }}>
                AI priority ranking isn&apos;t part of the demo walkthrough. Your {demoCacheQuery.data?.threads.length ?? 0} sample threads are on the Inbox tab.
              </p>
              <button
                type="button"
                className="thread-btn-accent"
                style={{ marginTop: 14, fontSize: 12, padding: "8px 14px" }}
                onClick={() => setView("inbox")}
              >
                Go to Inbox
              </button>
            </div>
          ) : view === "priority" && !priorityReady && isConnected && aiReady ? (
            <SkeletonList count={8} />
          ) : inbox.isLoading ? (
            <SkeletonList count={10} />
          ) : inbox.isError ? (
            <QueryErrorState
              title="Couldn't load inbox"
              message={inbox.error?.message}
              onRetry={() => void inbox.refetch()}
              className="thread-empty-inbox"
            />
          ) : visibleThreads.length === 0 ? (
            <div className="thread-empty-inbox" style={{ marginTop: 8 }}>
              <Inbox size={20} style={{ opacity: 0.35 }} />
              <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--thread-muted)" }}>
                {appliedQuery
                  ? "No matches"
                  : view === "priority"
                    ? "Nothing urgent right now"
                    : hasDemoFixtures
                      ? "No threads here"
                      : "Inbox is empty"}
              </p>
              {appliedQuery ? (
                <p style={{ marginTop: 6, fontSize: 12, color: "var(--thread-dim)" }}>
                  Nothing matched “{appliedQuery}”.
                </p>
              ) : view === "priority" ? (
                <p style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--thread-dim)" }}>
                  Switch to Inbox to browse all mail.
                </p>
              ) : hasDemoFixtures ? (
                <p style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--thread-dim)" }}>
                  {demoCacheQuery.data?.threads.length ?? 0} sample threads are on the Inbox tab.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              {visibleThreads.map((thread) => {
                const priority =
                  view === "priority" && priorityAnalysis
                    ? priorityByThreadId.get(thread.id)
                    : undefined;
                const isSnoozed = snoozedIds.has(thread.id);
                if (isSnoozed) return null;
                const isSelected = selectedId === thread.id;
                const isChecked = bulkSelected.has(thread.id);
                return (
                <div
                  key={thread.id}
                  className="thread-inbox-row-wrap"
                  data-active={isSelected}
                  data-checked={isChecked}
                  data-priority={priority?.urgency}
                >
                  {bulkMode ? (
                    <input
                      type="checkbox"
                      className="thread-inbox-checkbox"
                      checked={isChecked}
                      onChange={() => toggleBulk(thread.id)}
                      aria-label={`Select ${thread.subject ?? "thread"}`}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="thread-inbox-row"
                    data-active={isSelected}
                    data-unread={thread.unread ? "true" : undefined}
                    onClick={() => {
                      if (bulkMode) { toggleBulk(thread.id); return; }
                      setSelectedId(thread.id);
                    }}
                  >
                    <span className="thread-inbox-row-line">
                      <span className="thread-inbox-row-sender">
                        {priority ? (
                          <span
                            className="thread-inbox-priority-dot"
                            data-urgency={priority.urgency}
                            aria-hidden
                          />
                        ) : thread.unread ? (
                          <span className="thread-inbox-row-dot" aria-hidden />
                        ) : null}
                        {thread.fromName?.trim() || thread.from?.trim() || "Unknown sender"}
                        {priority ? (
                          <PriorityBadge
                            urgency={priority.urgency}
                            score={priority.score}
                            reason={priority.reason}
                            compact
                          />
                        ) : null}
                        {thread.messageCount && thread.messageCount > 1 ? (
                          <span className="thread-inbox-row-count">{thread.messageCount}</span>
                        ) : null}
                      </span>
                      <span className="thread-inbox-row-date">{formatListDate(thread.date)}</span>
                    </span>
                    <span className="thread-inbox-row-subject">
                      {listThreadSubject(thread.subject, thread.snippet)}
                      {threadLikelyHasAttachment(thread) ? (
                        <Paperclip size={11} style={{ marginLeft: 6, opacity: 0.55, verticalAlign: "middle" }} aria-label="Likely has attachment" />
                      ) : null}
                    </span>
                    <span className="thread-inbox-row-snippet">
                      {priority?.reason
                        ? priority.reason
                        : decodeHtmlEntities(thread.snippet)}
                    </span>
                  </button>
                  {!bulkMode ? (
                    <div className="thread-inbox-row-hover-actions">
                      <button
                        type="button"
                        className="thread-inbox-hover-btn"
                        title="Archive (e)"
                        onClick={(ev) => { ev.stopPropagation(); archiveThread.mutate({ threadId: thread.id }); }}
                      >
                        <Archive size={13} />
                      </button>
                      <button
                        type="button"
                        className="thread-inbox-hover-btn"
                        title="Snooze until tomorrow"
                        onClick={(ev) => { ev.stopPropagation(); snoozeThread(thread.id, "tomorrow"); }}
                      >
                        <BellOff size={13} />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
              })}
            </>
          )}
        </div>

        {isConnected && view === "inbox" && visibleThreads.length > 0 ? (
          <div className="thread-inbox-list-footer">
            {inbox.isRefreshing ? (
              <div className="thread-inbox-sync-dot">
                <Loader2 size={11} className="thread-spin" />
                <span>Syncing…</span>
              </div>
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
        {!isConnected && !hasDemoFixtures ? (
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
          <div className="thread-inbox-message thread-inbox-message--split">
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
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
                  {selectedAttachmentCount > 0 ? (
                    <p className="thread-inbox-message-count">
                      <Paperclip size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                      {selectedAttachmentCount === 1
                        ? "1 attachment in this thread"
                        : `${selectedAttachmentCount} attachments in this thread`}
                    </p>
                  ) : null}
                  {threadMessages.length > 1 ? (
                    <p className="thread-inbox-message-count">
                      {threadMessages.length} messages in this conversation
                    </p>
                  ) : null}
                </div>
                {/* Reading pane action toolbar — icon buttons */}
                <div className="thread-inbox-reading-toolbar">
                  <button
                    type="button"
                    className="thread-inbox-action-primary"
                    disabled={!calendarConnected || !replyTo.trim()}
                    onClick={() => setShowSchedule(true)}
                    title="Schedule meeting"
                  >
                    <CalendarPlus size={13} />
                    Schedule
                  </button>
                  <div className="thread-inbox-action-divider" />
                  <button
                    type="button"
                    className="thread-inbox-action-btn"
                    data-active={selectedId && starredIds.has(selectedId) ? "true" : undefined}
                    disabled={starThread.isPending || unstarThread.isPending}
                    onClick={() => {
                      if (!selectedId) return;
                      starredIds.has(selectedId)
                        ? unstarThread.mutate({ threadId: selectedId })
                        : starThread.mutate({ threadId: selectedId });
                    }}
                    title={selectedId && starredIds.has(selectedId) ? "Unstar" : "Star (s)"}
                  >
                    <Star size={15} fill={selectedId && starredIds.has(selectedId) ? "#fbbf24" : "none"} />
                  </button>
                  <button
                    type="button"
                    className="thread-inbox-action-btn"
                    data-important={selectedId && importantIds.has(selectedId) ? "true" : undefined}
                    disabled={markImportant.isPending || markNotImportant.isPending}
                    onClick={() => {
                      if (!selectedId) return;
                      importantIds.has(selectedId)
                        ? markNotImportant.mutate({ threadId: selectedId })
                        : markImportant.mutate({ threadId: selectedId });
                    }}
                    title={selectedId && importantIds.has(selectedId) ? "Remove important" : "Mark important (i)"}
                  >
                    <Zap size={15} fill={selectedId && importantIds.has(selectedId) ? "#a78bfa" : "none"} />
                  </button>
                  <div className="thread-inbox-action-divider" />
                  <button
                    type="button"
                    className="thread-inbox-action-btn"
                    disabled={archiveThread.isPending}
                    onClick={() => { if (selectedId) { archiveThread.mutate({ threadId: selectedId }); setSelectedId(null); } }}
                    title="Archive (e)"
                  >
                    <Archive size={15} />
                  </button>
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="thread-inbox-action-btn"
                      title="Snooze (b)"
                      onClick={() => {
                        const el = document.getElementById("thread-snooze-menu");
                        if (el) el.style.display = el.style.display === "none" ? "block" : "none";
                      }}
                    >
                      <BellOff size={15} />
                    </button>
                    <div id="thread-snooze-menu" className="thread-snooze-menu" style={{ display: "none" }}>
                      {([
                        { label: "Tomorrow 8am", when: "tomorrow" as const },
                        { label: "Next week", when: "nextweek" as const },
                      ]).map(({ label, when }) => (
                        <button
                          key={when}
                          type="button"
                          className="thread-snooze-option"
                          onClick={() => {
                            if (selectedId) {
                              snoozeThread(selectedId, when);
                              setSelectedId(null);
                            }
                            const el = document.getElementById("thread-snooze-menu");
                            if (el) el.style.display = "none";
                          }}
                        >
                          <Clock size={11} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="thread-inbox-action-btn thread-inbox-action-btn--danger"
                    disabled={trashThread.isPending}
                    onClick={() => { if (selectedId) trashThread.mutate({ threadId: selectedId }); }}
                    title="Move to trash"
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    type="button"
                    className="thread-inbox-action-btn"
                    disabled={muteThread.isPending || unmuteThread.isPending}
                    onClick={() => {
                      if (!selectedId) return;
                      if (mutedThreadIds.has(selectedId)) {
                        unmuteThread.mutate({ threadId: selectedId });
                      } else {
                        muteThread.mutate({ threadId: selectedId });
                      }
                    }}
                    title={
                      mutedThreadIds.has(selectedId ?? "")
                        ? "Unmute thread"
                        : "Mute thread (m) — future messages skip inbox"
                    }
                  >
                    <BellOff size={15} style={{ opacity: mutedThreadIds.has(selectedId ?? "") ? 1 : 0.6 }} />
                  </button>
                  <div className="thread-inbox-action-divider" />
                  <div ref={labelPickerRef} style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="thread-inbox-action-btn"
                      onClick={() => setShowLabelPicker((v) => !v)}
                      title="Apply label"
                    >
                      <Tag size={15} />
                    </button>
                    {showLabelPicker ? (
                      <div className="thread-label-picker">
                        {labelsQuery.isLoading ? (
                          <p className="thread-label-picker-head" style={{ padding: "8px 12px" }}>Loading labels…</p>
                        ) : labelsQuery.isError ? (
                          <p className="thread-label-picker-head" style={{ padding: "8px 12px", color: "var(--thread-danger, #f87171)" }}>Failed to load labels</p>
                        ) : !labelsQuery.data?.length ? (
                          <p className="thread-label-picker-head" style={{ padding: "8px 12px" }}>No labels found</p>
                        ) : (
                          <>
                            <p className="thread-label-picker-head">Apply label</p>
                            {labelsQuery.data
                              .filter((l) => l.type !== "system" || ["STARRED", "IMPORTANT"].includes(l.id))
                              .slice(0, 15)
                              .map((label) => (
                                <button
                                  key={`apply-${label.id}`}
                                  type="button"
                                  className="thread-label-picker-item"
                                  onClick={() => {
                                    if (selectedId) applyLabel.mutate({ threadId: selectedId, labelId: label.id });
                                    setShowLabelPicker(false);
                                  }}
                                >
                                  {label.name}
                                </button>
                              ))}
                            <p className="thread-label-picker-head" style={{ marginTop: 8 }}>Remove label</p>
                            {labelsQuery.data
                              .filter((l) => l.type !== "system" || ["STARRED", "IMPORTANT"].includes(l.id))
                              .slice(0, 15)
                              .map((label) => (
                                <button
                                  key={`remove-${label.id}`}
                                  type="button"
                                  className="thread-label-picker-item"
                                  data-variant="remove"
                                  onClick={() => {
                                    if (selectedId) removeLabel.mutate({ threadId: selectedId, labelId: label.id });
                                    setShowLabelPicker(false);
                                  }}
                                >
                                  {label.name}
                                </button>
                              ))}
                            <div className="thread-label-picker-create" style={{ padding: "8px 12px", borderTop: "1px solid var(--thread-border, #222)" }}>
                              <p className="thread-label-picker-head">Create label</p>
                              <div style={{ display: "flex", gap: 8 }}>
                                <input
                                  type="text"
                                  value={newLabelName}
                                  onChange={(e) => setNewLabelName(e.target.value)}
                                  placeholder="Label name"
                                  maxLength={200}
                                  style={{ flex: 1, fontSize: 13 }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && newLabelName.trim()) {
                                      createLabel.mutate({ name: newLabelName.trim() });
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="thread-btn-ghost"
                                  disabled={!newLabelName.trim() || createLabel.isPending}
                                  onClick={() => createLabel.mutate({ name: newLabelName.trim() })}
                                >
                                  {createLabel.isPending ? "…" : "Create"}
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="thread-inbox-action-btn"
                    style={showContextPanel ? { color: "var(--thread-accent-bright)" } : undefined}
                    onClick={() => setShowContextPanel((v) => !v)}
                    title="AI context panel"
                  >
                    <PanelRight size={15} />
                  </button>
                </div>
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
                                {message.attachments.map((att) => {
                                  const sizeLabel = att.size > 0
                                    ? att.size < 1024
                                      ? `${att.size} B`
                                      : att.size < 1024 * 1024
                                        ? `${Math.round(att.size / 1024)} KB`
                                        : `${(att.size / (1024 * 1024)).toFixed(1)} MB`
                                    : null;
                                  const downloadUrl = att.attachmentId && message.id
                                    ? `/inbox/attachments/${message.id}/${att.attachmentId}?filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType ?? "application/octet-stream")}`
                                    : null;
                                  return (
                                    <li key={att.attachmentId ?? att.filename} className="thread-inbox-attachment-item">
                                      <FileText size={12} />
                                      {downloadUrl ? (
                                        <a
                                          href={downloadUrl}
                                          download={att.filename}
                                          className="thread-inbox-attachment-name thread-inbox-attachment-link"
                                          title={`Download ${att.filename}`}
                                        >
                                          {att.filename}
                                        </a>
                                      ) : (
                                        <span className="thread-inbox-attachment-name">{att.filename}</span>
                                      )}
                                      {sizeLabel ? (
                                        <span className="thread-inbox-attachment-size">{sizeLabel}</span>
                                      ) : null}
                                    </li>
                                  );
                                })}
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

            {/* ── Unsubscribe banner ─────────────────────────────────────────── */}
            {(() => {
              const msgs = selectedQuery.data.messages ?? [];
              const allText = msgs.map((m) => (m.body ?? "") + (m.bodyHtml ?? "")).join(" ");
              const unsubMatch = allText.match(/href=["']([^"']*?unsubscribe[^"']*?)["']/i)
                ?? allText.match(/href=["']([^"']*?optout[^"']*?)["']/i)
                ?? allText.match(/href=["']([^"']*?opt-out[^"']*?)["']/i);
              if (!unsubMatch) return null;
              const unsubUrl = unsubMatch[1];
              return (
                <div className="thread-unsub-banner">
                  <span className="thread-unsub-banner-label">Looks like a mailing list</span>
                  <a
                    href={unsubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="thread-unsub-btn"
                  >
                    <ExternalLink size={11} />
                    Unsubscribe
                  </a>
                  <button
                    type="button"
                    className="thread-unsub-archive"
                    onClick={() => selectedId && archiveThread.mutate({ threadId: selectedId })}
                  >
                    <Archive size={11} />
                    Archive
                  </button>
                </div>
              );
            })()}

            {/* ── RSVP inline ────────────────────────────────────────────────── */}
            {rsvpIsInvite && (
              <div className="thread-rsvp-banner">
                <div className="thread-rsvp-banner-label">
                  <CalendarPlus size={13} />
                  <strong>Meeting invite detected</strong>
                  {rsvpEvent && (
                    <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 11, marginLeft: 6 }}>
                      — {rsvpEvent.summary}
                    </span>
                  )}
                </div>
                <div className="thread-rsvp-actions">
                  {rsvpEvent ? (
                    <>
                      <button
                        type="button"
                        className="thread-rsvp-btn thread-rsvp-btn--accept"
                        onClick={() => {
                          void utils.client.calendar.respondToEvent
                            .mutate({ eventId: rsvpEvent.id, response: "accepted" })
                            .then(() => toast.success("Accepted — calendar updated via Corsair"))
                            .catch((e: Error) => toast.error(e.message));
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="thread-rsvp-btn thread-rsvp-btn--tentative"
                        onClick={() => {
                          void utils.client.calendar.respondToEvent
                            .mutate({ eventId: rsvpEvent.id, response: "tentative" })
                            .then(() => toast.success("Marked tentative"))
                            .catch((e: Error) => toast.error(e.message));
                        }}
                      >
                        Maybe
                      </button>
                      <button
                        type="button"
                        className="thread-rsvp-btn thread-rsvp-btn--decline"
                        onClick={() => {
                          void utils.client.calendar.respondToEvent
                            .mutate({ eventId: rsvpEvent.id, response: "declined" })
                            .then(() => toast.success("Declined — calendar updated"))
                            .catch((e: Error) => toast.error(e.message));
                        }}
                      >
                        Decline
                      </button>
                    </>
                  ) : (
                    <Link href="/calendar" className="thread-rsvp-btn thread-rsvp-btn--accept">
                      View in Calendar
                    </Link>
                  )}
                  <button
                    type="button"
                    className="thread-btn-ghost"
                    style={{ fontSize: 12, padding: "6px 10px" }}
                    onClick={() => setShowSchedule(true)}
                  >
                    <CalendarPlus size={12} />
                    Schedule
                  </button>
                </div>
              </div>
            )}

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
              <label className="thread-set-label" htmlFor="reply-cc">
                Cc
              </label>
              <input
                id="reply-cc"
                className="thread-set-input"
                placeholder="Optional — comma-separated"
                value={replyCc}
                onChange={(event) => setReplyCc(event.target.value)}
              />
              <label className="thread-set-label" htmlFor="reply-bcc">
                Bcc
              </label>
              <input
                id="reply-bcc"
                className="thread-set-input"
                placeholder="Optional — comma-separated"
                value={replyBcc}
                onChange={(event) => setReplyBcc(event.target.value)}
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
              {/* AI Thread Summary */}
              {aiReady && selectedId ? (
                <div className="thread-smart-reply-wrap thread-ai-panel">
                  {!isConnected && hasDemoFixtures && !demoSummarizeEnabled ? (
                    <button
                      type="button"
                      className="thread-btn-ghost"
                      style={{ fontSize: 12 }}
                      disabled={isDemoUser && mailDemoState.isExhausted}
                      onClick={() => {
                        if (isDemoUser && !tryMailDemo()) return;
                        setDemoSummarizeEnabled(true);
                      }}
                    >
                      <Sparkles size={12} />
                      {isDemoUser && mailDemoState.isExhausted
                        ? "Inbox AI limit reached"
                        : `Summarize with AI (${mailDemoState.remaining}/${mailDemoState.limit} left)`}
                    </button>
                  ) : summarizeQuery.isLoading ? (
                    <div className="thread-smart-reply-loading">
                      <Sparkles size={11} style={{ color: "var(--thread-accent)" }} className="thread-spin" />
                      <span>Summarizing thread…</span>
                    </div>
                  ) : summarizeQuery.isError ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <p className="thread-smart-reply-label" style={{ color: "#f87171", margin: 0 }}>Summary failed</p>
                      <button type="button" onClick={() => summarizeQuery.refetch()} style={{ fontSize: 11, color: "var(--thread-accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Retry</button>
                    </div>
                  ) : summarizeQuery.data ? (
                    <>
                      <p className="thread-smart-reply-label" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <Sparkles size={11} style={{ color: "var(--thread-accent)" }} />
                        AI Summary
                        {summarizeQuery.data.sentiment && summarizeQuery.data.sentiment !== "neutral" ? (
                          <span className={`thread-ai-sentiment thread-ai-sentiment--${summarizeQuery.data.sentiment === "urgent" ? "urgent" : summarizeQuery.data.sentiment === "positive" ? "positive" : "negative"}`}>
                            {summarizeQuery.data.sentiment}
                          </span>
                        ) : null}
                      </p>
                      <p className="thread-ai-summary-text">
                        {summarizeQuery.data.summary}
                      </p>
                      {summarizeQuery.data.actionItems?.length ? (
                        <div className="thread-ai-action-list">
                          {summarizeQuery.data.actionItems.slice(0, 3).map((item, i) => (
                            <span key={i} className="thread-ai-action-chip">
                              ✓ {item.action}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              {/* Smart Reply suggestions */}
              {aiReady && selectedId && (isConnected || demoSummarizeEnabled) ? (
                <div className="thread-smart-reply-wrap thread-ai-panel">
                  {smartRepliesQuery.isLoading ? (
                    <div className="thread-smart-reply-loading">
                      <Loader2 size={11} className="thread-spin" />
                      <span>Generating reply suggestions…</span>
                    </div>
                  ) : smartRepliesQuery.data?.suggestions?.length ? (
                    <>
                      <p className="thread-smart-reply-label">
                        <Sparkles size={11} />
                        Smart replies — click to use
                      </p>
                      <div className="thread-smart-reply-chips">
                        {smartRepliesQuery.data.suggestions.map((s) => (
                          <button
                            key={s.label}
                            type="button"
                            className="thread-smart-reply-chip"
                            onClick={() => {
                              setReplyBody(s.body);
                              if (smartRepliesQuery.data?.replyTo && !replyTo.trim()) {
                                setReplyTo(smartRepliesQuery.data.replyTo);
                              }
                            }}
                            title={s.body}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
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
              <label className="thread-set-label" htmlFor="reply-attachments">
                Attachments
              </label>
              <input
                id="reply-attachments"
                type="file"
                multiple
                className="thread-set-input"
                onChange={(event) => void pickAttachments(event.target.files)}
              />
              {outboundAttachments.length > 0 ? (
                <ul className="thread-inbox-attachment-list" style={{ marginBottom: 8 }}>
                  {outboundAttachments.map((att, index) => (
                    <li key={`${att.filename}-${index}`} className="thread-inbox-attachment-item">
                      <FileText size={12} />
                      <span className="thread-inbox-attachment-name">{att.filename}</span>
                      <button
                        type="button"
                        className="thread-btn-ghost"
                        style={{ marginLeft: "auto", fontSize: 11, padding: "2px 6px" }}
                        onClick={() =>
                          setOutboundAttachments((current) => current.filter((_, i) => i !== index))
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
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
          {/* Smart Context Panel */}
          {showContextPanel && selectedId ? (
            <div className="scp-sidebar">
              <SmartContextPanel
                threadId={selectedId}
                onOpenThread={(id) => setSelectedId(id)}
              />
            </div>
          ) : null}
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

      {showCompose ? (
        <div className="thread-modal-backdrop" onClick={() => !queueEmail.isPending && setShowCompose(false)}>
          <div className="thread-modal" onClick={(event) => event.stopPropagation()}>
            <div className="thread-modal-head">
              <h3>New message</h3>
              <button
                type="button"
                className="thread-app-iconbtn"
                disabled={queueEmail.isPending}
                onClick={() => setShowCompose(false)}
              >
                <X size={14} />
              </button>
            </div>
            <form
              className="thread-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!composeTo.trim() || !composeBody.trim()) return;
                queueEmail.mutate({
                  mode: "send",
                  email: {
                    to: composeTo.trim(),
                    subject: composeSubject.trim() || "(no subject)",
                    body: composeBody,
                    cc: composeCc.trim() || undefined,
                    bcc: composeBcc.trim() || undefined,
                    attachments: outboundAttachments.length ? outboundAttachments : undefined,
                  },
                  title: `Send: ${composeSubject.trim() || "(no subject)"}`,
                });
              }}
            >
              <label className="thread-set-label" htmlFor="compose-to">
                To
              </label>
              <input
                id="compose-to"
                className="thread-set-input"
                type="email"
                value={composeTo}
                onChange={(event) => setComposeTo(event.target.value)}
                required
              />
              <label className="thread-set-label" htmlFor="compose-cc">
                Cc
              </label>
              <input
                id="compose-cc"
                className="thread-set-input"
                type="email"
                value={composeCc}
                onChange={(event) => setComposeCc(event.target.value)}
                placeholder="Optional"
              />
              <label className="thread-set-label" htmlFor="compose-bcc">
                Bcc
              </label>
              <input
                id="compose-bcc"
                className="thread-set-input"
                type="email"
                value={composeBcc}
                onChange={(event) => setComposeBcc(event.target.value)}
                placeholder="Optional"
              />
              <label className="thread-set-label" htmlFor="compose-subject">
                Subject
              </label>
              <input
                id="compose-subject"
                className="thread-set-input"
                value={composeSubject}
                onChange={(event) => setComposeSubject(event.target.value)}
              />
              <label className="thread-set-label" htmlFor="compose-body">
                Message
              </label>
              <textarea
                id="compose-body"
                className="thread-set-input thread-inbox-compose-body"
                rows={8}
                value={composeBody}
                onChange={(event) => setComposeBody(event.target.value)}
                placeholder="Write your message…"
                required
              />
              <label className="thread-set-label" htmlFor="compose-attachments">
                Attachments
              </label>
              <input
                id="compose-attachments"
                type="file"
                multiple
                className="thread-set-input"
                onChange={(event) => void pickAttachments(event.target.files)}
              />
              {outboundAttachments.length > 0 ? (
                <ul className="thread-inbox-attachment-list" style={{ marginBottom: 8 }}>
                  {outboundAttachments.map((att, index) => (
                    <li key={`${att.filename}-${index}`} className="thread-inbox-attachment-item">
                      <FileText size={12} />
                      <span className="thread-inbox-attachment-name">{att.filename}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="thread-modal-actions">
                <button type="button" className="thread-btn-ghost" onClick={() => setShowCompose(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="thread-btn-ghost"
                  disabled={queueEmail.isPending || !composeBody.trim()}
                  onClick={() =>
                    queueEmail.mutate({
                      mode: "draft",
                      email: {
                        to: composeTo.trim(),
                        subject: composeSubject.trim() || "(no subject)",
                        body: composeBody,
                        attachments: outboundAttachments.length ? outboundAttachments : undefined,
                      },
                      title: "New draft",
                    })
                  }
                >
                  <FilePenLine size={14} />
                  Save draft
                </button>
                <button type="submit" className="thread-btn-accent" disabled={queueEmail.isPending || !composeBody.trim()}>
                  <Mail size={14} />
                  {queueEmail.isPending ? "Queuing…" : "Queue send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {mailDemoModal}
    </div>
  );
}
