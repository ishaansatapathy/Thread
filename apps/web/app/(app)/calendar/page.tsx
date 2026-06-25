"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Calendar as CalIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  ListChecks,
  Loader2,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import { parseQuickAddText } from "~/lib/parse-quick-add-client";
import {
  demoEventMatchesDelete,
  isQuickDeleteIntent,
  parseQuickDeleteText,
} from "~/lib/parse-quick-delete-client";
import { useDemoAiGuard } from "~/components/app/demo-limit-modal";
import type { RouterOutputs } from "@repo/trpc/client";
import { SkeletonList } from "~/components/app/skeleton-list";
import { QueryErrorState } from "~/components/app/query-error-state";
import { MeetingPrepPanel } from "~/components/app/meeting-prep-panel";
import { queueResultMessage } from "~/lib/queue-toast";
import {
  eventDayKey,
  eventToArchivePayload,
  eventToDeletePayload,
  isoToLocalDateTimeInput,
  localDateTimeRangeToPayload,
  localDayKey,
  toLocalDateTimeInput,
} from "~/lib/calendar-datetime";
import {
  type CalendarViewMode,
  getVisibleDays,
  navigateAnchor,
  prevNextAriaLabel,
  queryBoundsForView,
  viewPeriodLabel,
} from "~/lib/calendar-view";

/** Rich client-side demo events — no DB, no API. */
function makeDemoEvents(): CalendarEventItem[] {
  const today = new Date();
  today.setSeconds(0, 0);

  const ev1Start = new Date(today);
  ev1Start.setHours(10, 0, 0, 0);
  const ev1End = new Date(ev1Start);
  ev1End.setHours(10, 30, 0, 0);

  const ev2Start = new Date(today);
  ev2Start.setHours(11, 0, 0, 0);
  const ev2End = new Date(ev2Start);
  ev2End.setHours(12, 0, 0, 0);

  const ev3Start = new Date(today);
  ev3Start.setHours(15, 0, 0, 0);
  const ev3End = new Date(ev3Start);
  ev3End.setHours(16, 0, 0, 0);

  const ev4Start = new Date(today);
  ev4Start.setDate(today.getDate() + 1);
  ev4Start.setHours(14, 0, 0, 0);
  const ev4End = new Date(ev4Start);
  ev4End.setMinutes(30);

  const ev5Start = new Date(today);
  ev5Start.setDate(today.getDate() + 1);
  ev5Start.setHours(16, 0, 0, 0);
  const ev5End = new Date(ev5Start);
  ev5End.setHours(17, 0, 0, 0);

  return [
    {
      id: "demo-cal-1",
      summary: "Daily Brief standup",
      start: ev1Start.toISOString(),
      end: ev1End.toISOString(),
      location: "Virtual · meet.google.com/thread-demo",
      attendees: [
        { email: "demo@thread.dev", displayName: "You", responseStatus: "accepted", organizer: true },
      ],
    },
    {
      id: "demo-cal-2",
      summary: "Corsair Hackathon Demo",
      start: ev2Start.toISOString(),
      end: ev2End.toISOString(),
      location: "Virtual · meet.google.com/demo",
      attendees: [
        { email: "judge@corsair.dev", displayName: "Judge", responseStatus: "accepted" },
        { email: "demo@thread.dev", displayName: "Thread Demo", responseStatus: "accepted", organizer: true },
      ],
    },
    {
      id: "demo-cal-3",
      summary: "Focus block — deep work",
      start: ev3Start.toISOString(),
      end: ev3End.toISOString(),
      attendees: [],
    },
    {
      id: "demo-cal-4",
      summary: "Team sync — product review",
      start: ev4Start.toISOString(),
      end: ev4End.toISOString(),
      attendees: [
        { email: "team@example.com", displayName: "Team", responseStatus: "needsAction" },
      ],
    },
    {
      id: "demo-cal-5",
      summary: "Investor update prep",
      start: ev5Start.toISOString(),
      end: ev5End.toISOString(),
      location: "Conference room B",
      attendees: [
        { email: "founder@startup.io", displayName: "Alex", responseStatus: "accepted" },
      ],
    },
  ];
}

function recurrenceToRrule(rule: string, custom?: string): string[] | undefined {
  if (rule === "custom") {
    const trimmed = custom?.trim();
    if (!trimmed) return undefined;
    return [trimmed.startsWith("RRULE:") ? trimmed : `RRULE:${trimmed}`];
  }
  switch (rule) {
    case "daily":
      return ["RRULE:FREQ=DAILY"];
    case "weekly":
      return ["RRULE:FREQ=WEEKLY"];
    case "monthly":
      return ["RRULE:FREQ=MONTHLY"];
    default:
      return undefined;
  }
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_EVENT_CAP = 3;

function formatEventTime(value?: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "All day";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatEventWhen(start?: string, end?: string) {
  if (!start) return "";
  const startLabel = formatEventTime(start);
  const endLabel = end ? formatEventTime(end) : "";
  if (start.length === 10) return "All day";
  const day = new Date(start).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return endLabel ? `${day} · ${startLabel} – ${endLabel}` : `${day} · ${startLabel}`;
}

type CalendarEventItem = {
  id: string;
  summary: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  htmlLink?: string;
  status?: string;
  isRecurring?: boolean;
  recurringEventId?: string;
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; organizer?: boolean }>;
  pending?: boolean;
  pendingArchive?: boolean;
  pendingDelete?: boolean;
};

function readQueuedCalendar(payload: Record<string, unknown>) {
  const calendar = payload.calendar as Record<string, unknown> | undefined;
  if (calendar?.startDateTime && calendar?.endDateTime) {
    return {
      summary: String(calendar.summary ?? "Meeting"),
      startDateTime: String(calendar.startDateTime),
      endDateTime: String(calendar.endDateTime),
    };
  }
  if (payload.startDateTime && payload.endDateTime) {
    return {
      summary: String(payload.summary ?? "Meeting"),
      startDateTime: String(payload.startDateTime),
      endDateTime: String(payload.endDateTime),
    };
  }
  return null;
}

type QueueListItem = RouterOutputs["queue"]["list"]["items"][number];

function resolveQueueItemForEvent(event: CalendarEventItem, items: QueueListItem[]): QueueListItem | null {
  const active = items.filter((item) => item.status === "pending" || item.status === "processing");

  if (event.pending && event.id.startsWith("queue-")) {
    const queueItemId = event.id.slice("queue-".length);
    return active.find((item) => item.id === queueItemId) ?? null;
  }

  if (event.pendingDelete) {
    return (
      active.find((item) => {
        if (item.kind !== "calendar_delete") return false;
        return String(item.payload.eventId ?? "") === event.id;
      }) ?? null
    );
  }

  if (event.pendingArchive) {
    return (
      active.find((item) => {
        if (item.kind !== "calendar_archive") return false;
        return String(item.payload.eventId ?? "") === event.id;
      }) ?? null
    );
  }

  return null;
}

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [viewAnchor, setViewAnchor] = useState(() => new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [summary, setSummary] = useState("");
  const [attendee, setAttendee] = useState("");
  const [startAt, setStartAt] = useState(() =>
    toLocalDateTimeInput(new Date(Date.now() + 86_400_000)),
  );
  const [endAt, setEndAt] = useState(() =>
    toLocalDateTimeInput(new Date(Date.now() + 86_400_000 + 3_600_000)),
  );
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventItem | null>(null);
  const [showPrep, setShowPrep] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [eventSearchInput, setEventSearchInput] = useState("");
  const [dbSearchMode, setDbSearchMode] = useState(false);
  const [conflicts, setConflicts] = useState<CalendarEventItem[]>([]);
  const [isAllDay, setIsAllDay] = useState(false);
  // All-day event date pickers (date only, no time).
  const [allDayStart, setAllDayStart] = useState(() => {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [allDayEnd, setAllDayEnd] = useState(() => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [recurrenceRule, setRecurrenceRule] = useState("");
  const [customRrule, setCustomRrule] = useState("FREQ=WEEKLY;BYDAY=MO");
  const [rescheduleStart, setRescheduleStart] = useState("");
  const [rescheduleEnd, setRescheduleEnd] = useState("");
  const [recurringEditScope, setRecurringEditScope] = useState<"instance" | "series" | "following">("instance");
  const [queueAction, setQueueAction] = useState<{ event: CalendarEventItem; item: QueueListItem } | null>(null);

  const visibleDays = useMemo(() => getVisibleDays(viewMode, viewAnchor), [viewMode, viewAnchor]);
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const eventQuery = useMemo(() => {
    const bounds = queryBoundsForView(viewMode, viewAnchor);
    const q = eventSearchInput.trim();
    return {
      ...bounds,
      maxResults: viewMode === "month" ? 250 : 100,
      timeZone: browserTimeZone,
      ...(q ? { q } : {}),
    };
  }, [viewMode, viewAnchor, browserTimeZone, eventSearchInput]);
  const todayKey = localDayKey(new Date());
  const periodLabel = viewPeriodLabel(viewMode, viewAnchor);

  const statusQuery = trpc.calendar.connectionStatus.useQuery({});
  const meQuery = trpc.auth.me.useQuery({});
  const userEmail = meQuery.data?.email?.toLowerCase();
  const isConnected = statusQuery.data?.googlecalendar === "connected";
  const connectHref = `/api-connect/calendar?state=${encodeURIComponent("/calendar")}`;

  const { isDemo: isDemoUser, tryFeature, modal: demoModal } = useDemoAiGuard(userEmail, "calendar");
  const demoEvents = useMemo(() => (isDemoUser && !isConnected ? makeDemoEvents() : []), [isDemoUser, isConnected]);

  const [customDemoEvents, setCustomDemoEvents] = useState<CalendarEventItem[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("thread_demo_custom_events");
    return saved ? JSON.parse(saved) : makeDemoEvents();
  });

  useEffect(() => {
    if (isDemoUser && typeof window !== "undefined") {
      localStorage.setItem("thread_demo_custom_events", JSON.stringify(customDemoEvents));
    }
  }, [customDemoEvents, isDemoUser]);

  const eventsQuery = trpc.calendar.listEvents.useQuery(eventQuery, {
    enabled: isConnected && (!dbSearchMode || !eventSearchInput.trim()),
    refetchOnMount: "always",
    refetchInterval: isConnected && !dbSearchMode ? 30_000 : false,
    staleTime: 0,
  });

  const dbSearchTerm = eventSearchInput.trim();
  const dbEventsQuery = trpc.calendar.searchEventsDb.useQuery(
    { query: dbSearchTerm, limit: 100 },
    { enabled: isConnected && dbSearchMode && dbSearchTerm.length > 0, staleTime: 30_000 },
  );

  const calendarEvents = useMemo(() => {
    if (isDemoUser && !isConnected) return customDemoEvents;
    if (dbSearchMode && dbSearchTerm) return dbEventsQuery.data?.events ?? [];
    return eventsQuery.data?.events ?? [];
  }, [isDemoUser, isConnected, customDemoEvents, dbSearchMode, dbSearchTerm, dbEventsQuery.data?.events, eventsQuery.data?.events]);

  const eventsLoading =
    dbSearchMode && dbSearchTerm ? dbEventsQuery.isLoading : eventsQuery.isLoading;

  useEffect(() => {
    if (!selectedEvent) return;
    setRecurringEditScope("instance");
    if (selectedEvent.allDay) {
      setRescheduleStart(selectedEvent.start?.slice(0, 10) ?? "");
      setRescheduleEnd(selectedEvent.end?.slice(0, 10) ?? selectedEvent.start?.slice(0, 10) ?? "");
    } else {
      setRescheduleStart(isoToLocalDateTimeInput(selectedEvent.start));
      setRescheduleEnd(isoToLocalDateTimeInput(selectedEvent.end) || isoToLocalDateTimeInput(selectedEvent.start));
    }
  }, [selectedEvent]);

  const pendingQueue = trpc.queue.list.useQuery(
    { status: "pending" },
    { enabled: isConnected, staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true },
  );

  const checkFreeBusy = trpc.calendar.checkFreeBusy.useMutation({
    onSuccess: (data) => {
      if ("unavailable" in data && data.unavailable) {
        setConflicts([]);
        toast.message("Could not verify conflicts — calendar busy check unavailable.");
        return;
      }
      setConflicts(data.conflicts as CalendarEventItem[]);
    },
  });

  const queueInvite = trpc.queue.enqueueCalendar.useMutation({
    onSuccess: async (item) => {
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      const msg = queueResultMessage(item);
      toast.success(msg.title);
      setShowCreate(false);
      setSummary("");
      setAttendee("");
      setConflicts([]);
    },
    onError: (error) => toast.error(error.message),
  });

  const refreshEvents = async () => {
    await utils.calendar.listEvents.invalidate();
    await eventsQuery.refetch();
  };

  const queueArchive = trpc.queue.enqueueCalendarArchive.useMutation({
    onSuccess: async (item) => {
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      setSelectedEvent(null);
      toast.success(queueResultMessage(item).title);
    },
    onError: (error) => toast.error(error.message),
  });

  const respondToEvent = trpc.calendar.respondToEvent.useMutation({
    onSuccess: async (updated) => {
      toast.success("RSVP updated");
      setSelectedEvent(updated as CalendarEventItem);
      await utils.calendar.listEvents.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const queueDelete = trpc.queue.enqueueCalendarDelete.useMutation({
    onSuccess: async (item) => {
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      setSelectedEvent(null);
      setShowDeleteConfirm(false);
      setShowCancelConfirm(false);
      toast.success(queueResultMessage(item).title);
    },
    onError: (error) => toast.error(error.message),
  });

  const dismissQueueItem = trpc.queue.dismiss.useMutation({
    onSuccess: async (_data, vars) => {
      const item = queueAction?.item.id === vars.id ? queueAction.item : null;
      setQueueAction(null);
      utils.queue.list.setData({ status: "pending" }, (old) => {
        if (!old) return old;
        return { ...old, items: old.items.filter((entry) => entry.id !== vars.id) };
      });
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      if (item?.kind === "calendar_delete") {
        toast.success("Delete request cancelled — event stays on your calendar");
      } else if (item?.kind === "calendar_invite" || item?.kind === "meeting_bundle") {
        toast.success("Queued invite removed");
      } else {
        toast.success("Removed from queue");
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const approveQueueItem = trpc.queue.approve.useMutation({
    onSuccess: async (data) => {
      setQueueAction(null);
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      await utils.calendar.listEvents.invalidate();
      toast.success(queueResultMessage(data).title);
    },
    onError: (error) => toast.error(error.message),
  });

  const [quickAddText, setQuickAddText] = useState("");
  const quickAddEvent = trpc.calendar.quickAddEvent.useMutation({
    onSuccess: async (item) => {
      setQuickAddText("");
      toast.success(queueResultMessage(item).title);
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      await utils.calendar.listEvents.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const banner = useMemo(() => {
    if (searchParams.get("calendar") === "connected") {
      return { type: "success" as const, text: "Google Calendar connected successfully." };
    }
    const error = searchParams.get("error");
    if (error) return { type: "error" as const, text: error };
    return null;
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("calendar") === "connected") {
      void utils.calendar.connectionStatus.invalidate();
    }
  }, [searchParams, utils]);

  // Deep-link: ?event=ID auto-opens the event modal.
  // If event not in current week load, widen to ±30 days and re-anchor.
  const [deepLinkSearched, setDeepLinkSearched] = useState(false);
  const deepLinkEventId = searchParams.get("event");

  const wideEventsQuery = trpc.calendar.listEvents.useQuery(
    {
      timeMin: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      timeMax: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      maxResults: 200,
      timeZone: browserTimeZone,
    },
    {
      enabled: Boolean(deepLinkEventId) && !deepLinkSearched && isConnected,
      staleTime: 5 * 60_000,
    },
  );

  useEffect(() => {
    const eventId = searchParams.get("event");
    if (!eventId) return;

    // First try current week
    if (eventsQuery.data?.events) {
      const found = eventsQuery.data.events.find((e) => e.id === eventId);
      if (found) {
        setSelectedEvent(found as CalendarEventItem);
        setShowPrep(true);
        setDeepLinkSearched(true);
        return;
      }
    }

    // Try wide search
    if (wideEventsQuery.data?.events) {
      const found = wideEventsQuery.data.events.find((e) => e.id === eventId);
      if (found) {
        // Navigate calendar to that event's week
        if (found.start) setViewAnchor(new Date(found.start));
        setSelectedEvent(found as CalendarEventItem);
        setShowPrep(true);
      }
      setDeepLinkSearched(true);
    }
  }, [searchParams, eventsQuery.data, wideEventsQuery.data]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const { date } of visibleDays) {
      map.set(localDayKey(date), []);
    }
    for (const event of calendarEvents) {
      if (event.status?.toLowerCase() === "cancelled") continue;
      const key = eventDayKey(event.start);
      if (!key || !map.has(key)) continue;
      map.get(key)!.push(event);
    }
    for (const item of pendingQueue.data?.items ?? []) {
      if (item.status !== "pending" && item.status !== "processing") continue;
      if (item.kind === "calendar_archive") {
        const payload = item.payload;
        const eventId = String(payload.eventId ?? "");
        const summary = String(payload.summary ?? item.title.replace(/^Reschedule:\s*/i, ""));
        const start = String(payload.startDateTime ?? "");
        const end = String(payload.endDateTime ?? "");
        const key = eventDayKey(start);
        if (!key || !map.has(key)) continue;
        const dayEvents = map.get(key)!;
        const existing = dayEvents.find((entry) => entry.id === eventId);
        if (existing) {
          existing.pendingArchive = true;
        } else {
          dayEvents.push({
            id: eventId || `queue-archive-${item.id}`,
            summary,
            start,
            end,
            pendingArchive: true,
          });
        }
        continue;
      }

      if (item.kind === "calendar_delete") {
        const payload = item.payload;
        const eventId = String(payload.eventId ?? "");
        for (const [, dayEvents] of map) {
          const existing = dayEvents.find((entry) => entry.id === eventId);
          if (existing) {
            existing.pendingDelete = true;
          }
        }
        continue;
      }

      if (item.kind !== "calendar_invite" && item.kind !== "meeting_bundle") continue;
      const queued = readQueuedCalendar(item.payload);
      if (!queued) continue;
      const key = eventDayKey(queued.startDateTime);
      if (!key || !map.has(key)) continue;
      map.get(key)!.push({
        id: `queue-${item.id}`,
        summary: queued.summary,
        start: queued.startDateTime,
        end: queued.endDateTime,
        pending: true,
      });
    }
    for (const [, dayEvents] of map) {
      dayEvents.sort((a, b) => {
        const aTime = a.start ? new Date(a.start).getTime() : 0;
        const bTime = b.start ? new Date(b.start).getTime() : 0;
        return aTime - bTime;
      });
    }
    return map;
  }, [calendarEvents, pendingQueue.data?.items, visibleDays]);

  const eventBusy = queueArchive.isPending || queueDelete.isPending;

  const openQueueOverlay = (event: CalendarEventItem) => {
    const item = resolveQueueItemForEvent(event, pendingQueue.data?.items ?? []);
    if (item) {
      setQueueAction({ event, item });
      return;
    }
    router.push("/queue");
  };

  const mobileListEvents = useMemo(() => {
    const items: CalendarEventItem[] = [];
    for (const { date } of visibleDays) {
      const key = localDayKey(date);
      for (const event of eventsByDay.get(key) ?? []) {
        items.push(event);
      }
    }
    return items;
  }, [visibleDays, eventsByDay]);

  const openEvent = (event: CalendarEventItem) => {
    if (event.pending || event.pendingArchive || event.pendingDelete) {
      openQueueOverlay(event);
      return;
    }
    setSelectedEvent(event);
    setShowPrep(false);
  };

  const focusDay = (date: Date) => {
    setViewAnchor(new Date(date));
    setViewMode("day");
  };

  return (
    <div>
      {!isConnected && !isDemoUser ? (
        <div className="thread-app-banner">
          <div className="thread-app-banner-icon">
            <CalIcon size={18} />
          </div>
          <div className="thread-app-banner-text">
            <h4>Calendar not connected</h4>
            <p>Connect Google Calendar via Corsair to see events and send invites in one step.</p>
          </div>
          <a href={connectHref} className="thread-btn-accent">
            Connect
          </a>
        </div>
      ) : (
        <>
          {isDemoUser && !isConnected && (
            <div className="thread-app-banner" style={{ margin: "0 0 16px 0", padding: "10px 14px", border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <div className="thread-app-banner-icon" style={{ padding: 4, width: 26, height: 26, minWidth: 26, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CalIcon size={14} />
              </div>
              <div className="thread-app-banner-text" style={{ flex: 1 }}>
                <h4 style={{ fontSize: 13, margin: 0 }}>Demo calendar — AI quick-add</h4>
                <p style={{ fontSize: 11.5, margin: "2px 0 0", opacity: 0.8 }}>5 sample events · 3 AI quick-adds in demo · connect for live sync</p>
              </div>
              <a href={connectHref} className="thread-btn-accent" style={{ fontSize: 11, padding: "4px 10px", height: "auto", display: "inline-flex", alignItems: "center" }}>
                Connect Calendar
              </a>
            </div>
          )}
          <div className="thread-cal-toolbar">
            <div>
              <h3 className="thread-cal-toolbar-title">
                {isDemoUser && !isConnected ? "Demo calendar preview" : "Your schedule"}
              </h3>
              <p className="thread-cal-toolbar-copy">
                {isDemoUser && !isConnected
                  ? "5 sample events · 3 demo calendar AI actions · connect Calendar for live sync"
                  : "Live events from Google Calendar. Dashed blocks are queued — approve in Queue to publish."}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <form
                style={{ display: "flex", alignItems: "center", gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = quickAddText.trim();
                  if (!text) return;

                  if (isDemoUser && !isConnected) {
                    if (!tryFeature()) return;

                    if (isQuickDeleteIntent(text)) {
                      try {
                        const parsed = parseQuickDeleteText(text);
                        setCustomDemoEvents((prev) =>
                          prev.filter(
                            (event) =>
                              !demoEventMatchesDelete(
                                event.summary ?? "",
                                event.start ?? "",
                                parsed,
                              ),
                          ),
                        );
                        setQuickAddText("");
                        toast.success("Matching events removed from preview");
                      } catch {
                        toast.error("Could not parse delete prompt.");
                      }
                      return;
                    }

                    try {
                      const parsed = parseQuickAddText(text);
                      const newEvent: CalendarEventItem = {
                        id: `demo-cal-custom-${Date.now()}`,
                        summary: parsed.summary,
                        start: parsed.startDateTime,
                        end: parsed.endDateTime,
                        allDay: parsed.allDay,
                        location: parsed.allDay ? "All day" : "Virtual",
                        attendees: [],
                      };
                      setCustomDemoEvents((prev) => [...prev, newEvent]);
                      setQuickAddText("");
                      toast.success(`Event "${parsed.summary}" added to preview`);
                    } catch (err) {
                      toast.error("Failed to parse prompt. Try 'Lunch tomorrow at noon'");
                    }
                    return;
                  }

                  quickAddEvent.mutate({ text });
                }}
              >
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, height: 34,
                  padding: "0 10px", borderRadius: 8,
                  border: "1px solid var(--thread-line)", background: "rgba(255,255,255,0.025)",
                }}>
                  <Sparkles size={12} style={{ color: "var(--thread-dim)", flexShrink: 0 }} />
                  <input
                    type="text"
                    value={quickAddText}
                    onChange={(e) => setQuickAddText(e.target.value)}
                    placeholder="Add: Lunch tomorrow · Delete: remove meeting with manu on 27 june"
                    style={{
                      border: "none", outline: "none", background: "transparent",
                      color: "var(--thread-text)", fontSize: 12, width: 240,
                    }}
                    disabled={quickAddEvent.isPending}
                  />
                </div>
                <button
                  type="submit"
                  className="thread-btn-ghost"
                  style={{ fontSize: 12, padding: "6px 10px" }}
                  disabled={!quickAddText.trim() || quickAddEvent.isPending}
                >
                  {quickAddEvent.isPending ? <Loader2 size={13} className="thread-spin" /> : <Plus size={13} />}
                  {quickAddEvent.isPending ? "Adding…" : "Add"}
                </button>
              </form>
              <button
                type="button"
                className="thread-btn-accent"
                onClick={() => setShowCreate(true)}
              >
                <Plus size={14} />
                New invite
              </button>
            </div>
          </div>
        </>
      )}

      {banner ? (
        <div
          className="thread-inbox-banner"
          data-variant={banner.type}
          style={{ margin: "12px 0 0" }}
        >
          {banner.text}
        </div>
      ) : null}

      <div className="thread-cal-head">
        <button
          type="button"
          className="thread-app-iconbtn"
          aria-label={prevNextAriaLabel(viewMode, -1)}
          onClick={() => setViewAnchor((current) => navigateAnchor(viewMode, current, -1))}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="thread-app-iconbtn"
          aria-label={prevNextAriaLabel(viewMode, 1)}
          onClick={() => setViewAnchor((current) => navigateAnchor(viewMode, current, 1))}
        >
          <ChevronRight size={15} />
        </button>
        <span className="thread-cal-period-label">{periodLabel}</span>

        <div className="thread-cal-view-switch" role="tablist" aria-label="Calendar view">
          {(["day", "week", "month"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={viewMode === mode}
              data-active={viewMode === mode ? "true" : undefined}
              onClick={() => setViewMode(mode)}
            >
              {mode === "day" ? "Day" : mode === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="thread-btn-ghost thread-cal-head-action"
          disabled={eventsQuery.isFetching}
          onClick={() => void refreshEvents()}
        >
          {eventsQuery.isFetching ? "Refreshing…" : "Refresh"}
        </button>
        <button
          type="button"
          className="thread-btn-ghost thread-cal-head-action"
          onClick={() => {
            setViewAnchor(new Date());
            setViewMode("week");
          }}
        >
          Today
        </button>
        <div className="thread-cal-search">
          <input
            type="search"
            value={eventSearchInput}
            onChange={(e) => setEventSearchInput(e.target.value)}
            placeholder={dbSearchMode ? "Corsair DB search (local cache)…" : "Search events…"}
            aria-label="Search calendar events"
          />
          <button
            type="button"
            className={`thread-inbox-db-toggle${dbSearchMode ? " thread-inbox-db-toggle--active" : ""}`}
            onClick={() => setDbSearchMode((v) => !v)}
            title="Toggle Corsair DB search (fast local cache)"
          >
            DB
          </button>
        </div>
      </div>

      {eventsLoading && isConnected ? (
        <SkeletonList count={7} />
      ) : eventsQuery.isError && isConnected ? (
        <QueryErrorState
          title="Couldn't load calendar"
          message={eventsQuery.error.message}
          onRetry={() => void eventsQuery.refetch()}
        />
      ) : (
        <>
        <div className="thread-cal-mobile-list">
          {mobileListEvents.length === 0 ? (
            <div className="thread-cal-empty-note">
              {viewMode === "day" ? "No events today" : viewMode === "month" ? "No events this month" : "No events this week"}
            </div>
          ) : (
            mobileListEvents.map((event) => (
              <button
                key={`mobile-${event.id}`}
                type="button"
                className="thread-cal-mobile-item"
                onClick={() => openEvent(event)}
              >
                <span className="thread-cal-mobile-item-when">
                  {formatEventWhen(event.start, event.end)}
                </span>
                <span className="thread-cal-mobile-item-title">{event.summary}</span>
              </button>
            ))
          )}
        </div>

        {viewMode === "month" ? (
          <div className="thread-cal-month-head" aria-hidden="true">
            {DOW.map((label) => (
              <div key={label} className="thread-cal-month-dow">
                {label}
              </div>
            ))}
          </div>
        ) : null}

        <div className="thread-cal-grid" data-view={viewMode}>
          {visibleDays.map(({ date, inMonth }) => {
            const key = localDayKey(date);
            const isToday = key === todayKey;
            const dayEvents = eventsByDay.get(key) ?? [];
            const compact = viewMode === "month";
            const visibleEvents = compact ? dayEvents.slice(0, MONTH_EVENT_CAP) : dayEvents;
            const hiddenCount = compact ? Math.max(0, dayEvents.length - MONTH_EVENT_CAP) : 0;
            return (
              <div
                key={key}
                className="thread-cal-col"
                data-outside={viewMode === "month" && !inMonth ? "true" : undefined}
              >
                <button
                  type="button"
                  className="thread-cal-colhead"
                  data-today={isToday}
                  onClick={() => focusDay(date)}
                  title={`Open ${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`}
                >
                  {viewMode !== "month" ? (
                    <div className="thread-cal-dow">{DOW[(date.getDay() + 6) % 7]}</div>
                  ) : null}
                  <div className="thread-cal-dom" data-today={isToday}>
                    {date.getDate()}
                  </div>
                </button>
                <div className="thread-cal-body">
                  {!isConnected && !isDemoUser ? (
                    <div className="thread-cal-empty-note">Connect Calendar to sync</div>
                  ) : dayEvents.length === 0 ? (
                    viewMode === "day" ? (
                      <div className="thread-cal-empty-note">Nothing scheduled — enjoy the free time.</div>
                    ) : (
                      <div className="thread-cal-empty-note">No events</div>
                    )
                  ) : (
                    <>
                      {visibleEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          className="thread-cal-event"
                          data-compact={compact ? "true" : undefined}
                          data-selected={selectedEvent?.id === event.id}
                          data-pending={event.pending ? "true" : undefined}
                          data-pending-archive={event.pendingArchive ? "true" : undefined}
                          data-pending-delete={event.pendingDelete ? "true" : undefined}
                          onClick={() => openEvent(event)}
                        >
                          <span className="thread-cal-event-time">
                            {event.pendingArchive
                              ? "Review · "
                              : event.pendingDelete
                                ? "Delete · "
                                : event.pending
                                  ? "Queued · "
                                  : ""}
                            {formatEventTime(event.start)}
                          </span>
                          <span className="thread-cal-event-title">
                            {event.isRecurring ? (
                              <Repeat size={10} className="thread-cal-event-recur" aria-label="Recurring" />
                            ) : null}
                            {event.summary}
                          </span>
                        </button>
                      ))}
                      {hiddenCount > 0 ? (
                        <button
                          type="button"
                          className="thread-cal-more-btn"
                          onClick={() => focusDay(date)}
                        >
                          +{hiddenCount} more
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {showCreate ? (
        <div className="thread-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="thread-modal" onClick={(event) => event.stopPropagation()}>
            <div className="thread-modal-head">
              <h3>Send calendar invite</h3>
              <button
                type="button"
                className="thread-app-iconbtn"
                onClick={() => setShowCreate(false)}
              >
                <X size={14} />
              </button>
            </div>
            <form
              className="thread-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  let startDateTime: string;
                  let endDateTime: string;
                  let timeZone: string;
                  if (isAllDay) {
                    // Google all-day events use date fields; end is exclusive.
                    const endExclusive = new Date(`${allDayEnd}T12:00:00`);
                    endExclusive.setDate(endExclusive.getDate() + 1);
                    const endDateStr = `${endExclusive.getFullYear()}-${String(endExclusive.getMonth() + 1).padStart(2, "0")}-${String(endExclusive.getDate()).padStart(2, "0")}`;
                    startDateTime = allDayStart;
                    endDateTime = endDateStr;
                    timeZone = "UTC";
                  } else {
                    const when = localDateTimeRangeToPayload(startAt, endAt);
                    startDateTime = when.startDateTime;
                    endDateTime = when.endDateTime;
                    timeZone = when.timeZone;
                  }

                  if (isDemoUser && !isConnected) {
                    if (!tryFeature()) return;

                    const newEvent: CalendarEventItem = {
                      id: `demo-cal-custom-${Date.now()}`,
                      summary,
                      start: startDateTime,
                      end: endDateTime,
                      allDay: isAllDay,
                      location: attendee.trim() ? `Meeting with ${attendee.trim()}` : "Virtual",
                      attendees: attendee.trim()
                        ? [{ email: attendee.trim(), displayName: attendee.trim().split("@")[0] || "Guest", responseStatus: "needsAction" }]
                        : [],
                    };
                    setCustomDemoEvents((prev) => [...prev, newEvent]);
                    setShowCreate(false);
                    setSummary("");
                    setAttendee("");
                    toast.success(`Event "${summary}" added to preview`);
                    return;
                  }

                  queueInvite.mutate({
                    calendar: {
                      summary,
                      description: "Scheduled from Thread calendar.",
                      startDateTime,
                      endDateTime,
                      timeZone,
                      allDay: isAllDay || undefined,
                      attendeeEmails: attendee.trim() ? [attendee.trim()] : undefined,
                      recurrence: recurrenceToRrule(recurrenceRule, customRrule),
                    },
                    title: summary,
                  });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Please review your dates");
                }
              }}
            >
              <label className="thread-set-label" htmlFor="event-summary">
                Title
              </label>
              <input
                id="event-summary"
                className="thread-set-input"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="Product sync"
                required
              />

              <label className="thread-set-label" htmlFor="event-attendee">
                Guest email
              </label>
              <input
                id="event-attendee"
                className="thread-set-input"
                type="email"
                value={attendee}
                onChange={(event) => setAttendee(event.target.value)}
                placeholder="guest@company.com"
              />

              {/* All-day toggle */}
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: "var(--thread-accent-bright, #60a5fa)" }}
                />
                <span className="thread-set-label" style={{ marginBottom: 0 }}>All-day event</span>
              </label>

              {isAllDay ? (
                <div className="thread-modal-row">
                  <div>
                    <label className="thread-set-label" htmlFor="event-allday-start">Start date</label>
                    <input
                      id="event-allday-start"
                      className="thread-set-input"
                      type="date"
                      value={allDayStart}
                      onChange={(e) => setAllDayStart(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="thread-set-label" htmlFor="event-allday-end">End date</label>
                    <input
                      id="event-allday-end"
                      className="thread-set-input"
                      type="date"
                      value={allDayEnd}
                      min={allDayStart}
                      onChange={(e) => setAllDayEnd(e.target.value)}
                      required
                    />
                  </div>
                </div>
              ) : (
                <div className="thread-modal-row">
                <div>
                  <label className="thread-set-label" htmlFor="event-start">
                    Starts
                  </label>
                  <input
                    id="event-start"
                    className="thread-set-input"
                    type="datetime-local"
                    value={startAt}
                    onChange={(event) => setStartAt(event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="thread-set-label" htmlFor="event-end">
                    Ends
                  </label>
                  <input
                    id="event-end"
                    className="thread-set-input"
                    type="datetime-local"
                    value={endAt}
                    onChange={(event) => {
                      setEndAt(event.target.value);
                      // Trigger free/busy check when both dates are set
                      if (startAt && event.target.value && isConnected) {
                        try {
                          const { startDateTime, endDateTime, timeZone } = localDateTimeRangeToPayload(
                            startAt,
                            event.target.value,
                          );
                          checkFreeBusy.mutate({ startDateTime, endDateTime, timeZone });
                        } catch {
                          // ignore validation errors during typing
                        }
                      }
                    }}
                    required
                  />
                </div>
              </div>
              )}

              <label className="thread-set-label" htmlFor="event-recurrence">
                Repeat
              </label>
              <select
                id="event-recurrence"
                className="thread-set-input"
                value={recurrenceRule}
                onChange={(event) => setRecurrenceRule(event.target.value)}
              >
                <option value="">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom RRULE…</option>
              </select>

              {recurrenceRule === "custom" ? (
                <>
                  <label className="thread-set-label" htmlFor="event-custom-rrule">
                    Custom RRULE
                  </label>
                  <input
                    id="event-custom-rrule"
                    className="thread-set-input"
                    value={customRrule}
                    onChange={(event) => setCustomRrule(event.target.value)}
                    placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
                  />
                </>
              ) : null}

              {conflicts.length > 0 ? (
                <div className="thread-cal-conflict-warning">
                  <p className="thread-cal-conflict-title">
                    ⚠ {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""} detected
                  </p>
                  <ul className="thread-cal-conflict-list">
                    {conflicts.map((c) => (
                      <li key={c.id} className="thread-cal-conflict-item">
                        {c.summary}
                        {c.start
                          ? ` · ${new Date(c.start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="thread-modal-actions">
                <button
                  type="button"
                  className="thread-btn-ghost"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="thread-btn-accent"
                  disabled={queueInvite.isPending}
                >
                  <ListChecks size={14} />
                  {queueInvite.isPending ? "Queuing…" : "Queue invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedEvent ? (
        <div className="thread-modal-backdrop" onClick={() => !eventBusy && setSelectedEvent(null)}>
          <div
            className="thread-modal thread-cal-event-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="thread-modal-head">
              <h3>{selectedEvent.summary}</h3>
              <button
                type="button"
                className="thread-btn-ghost"
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  marginLeft: "auto",
                  color: showPrep ? "var(--thread-accent)" : undefined,
                }}
                onClick={() => setShowPrep((v) => !v)}
              >
                <Sparkles size={13} style={{ marginRight: 4, verticalAlign: -1 }} />
                {showPrep ? "Hide prep" : "Meeting Prep"}
              </button>
              <button
                type="button"
                className="thread-app-iconbtn"
                disabled={eventBusy}
                onClick={() => setSelectedEvent(null)}
              >
                <X size={14} />
              </button>
            </div>
            {showPrep ? (
              <MeetingPrepPanel
                eventId={selectedEvent.id}
                timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
                onOpenThread={(threadId) => {
                  setSelectedEvent(null);
                  window.location.href = `/inbox?thread=${encodeURIComponent(threadId)}`;
                }}
              />
            ) : null}
            <div className="thread-cal-event-detail">
              <p className="thread-cal-event-when">
                {formatEventWhen(selectedEvent.start, selectedEvent.end)}
              </p>
              <div className="thread-cal-event-tags">
                {selectedEvent.isRecurring ? (
                  <span className="thread-cal-event-tag">
                    <Repeat size={12} />
                    Recurring series
                  </span>
                ) : null}
                {selectedEvent.attendees?.length ? (
                  <span className="thread-cal-event-tag">
                    <Users size={12} />
                    {selectedEvent.attendees.length} guest
                    {selectedEvent.attendees.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {selectedEvent.location ? (
                  <span className="thread-cal-event-tag">{selectedEvent.location}</span>
                ) : null}
              </div>
                {selectedEvent.isRecurring ? (
                <div className="thread-cal-recurring-scope" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="thread-set-label">Apply changes to</span>
                  <label className="thread-cal-scope-option" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="radio"
                      name="recurring-edit-scope"
                      checked={recurringEditScope === "instance"}
                      onChange={() => setRecurringEditScope("instance")}
                    />
                    This event only
                  </label>
                  <label className="thread-cal-scope-option" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="radio"
                      name="recurring-edit-scope"
                      checked={recurringEditScope === "series"}
                      onChange={() => setRecurringEditScope("series")}
                    />
                    All events in the series
                  </label>
                  <label className="thread-cal-scope-option" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="radio"
                      name="recurring-edit-scope"
                      checked={recurringEditScope === "following"}
                      onChange={() => setRecurringEditScope("following")}
                    />
                    This and following events
                  </label>
                  <p className="thread-cal-event-detail-copy" style={{ margin: 0 }}>
                    {recurringEditScope === "series"
                      ? "Reschedule or delete will update the entire recurring series on Google Calendar."
                      : recurringEditScope === "following"
                        ? "This occurrence and all future occurrences in the series will change."
                        : "Only this occurrence changes — other events in the series stay the same."}
                  </p>
                </div>
              ) : null}
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 ? (
                <ul className="thread-cal-attendee-list">
                  {selectedEvent.attendees.map((attendee) => (
                    <li key={attendee.email} className="thread-cal-attendee-item">
                      <span className="thread-cal-attendee-name">
                        {attendee.displayName || attendee.email}
                        {attendee.organizer ? (
                          <span style={{ fontSize: 10.5, color: "var(--thread-dim)", marginLeft: 4 }}>(organizer)</span>
                        ) : null}
                      </span>
                      {attendee.responseStatus ? (
                        <span className="thread-rsvp-badge" data-status={attendee.responseStatus}>
                          {attendee.responseStatus === "accepted"
                            ? "Accepted"
                            : attendee.responseStatus === "declined"
                              ? "Declined"
                              : attendee.responseStatus === "tentative"
                                ? "Maybe"
                                : "Pending"}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {/* RSVP — only show if the user is an attendee (has a responseStatus) */}
              {selectedEvent.attendees?.some((a) => a.responseStatus) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--thread-muted)", fontFamily: "var(--thread-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Your RSVP
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["accepted", "tentative", "declined"] as const).map((resp) => {
                      const Icon = resp === "accepted" ? Check : resp === "tentative" ? HelpCircle : XCircle;
                      const label = resp === "accepted" ? "Accept" : resp === "tentative" ? "Maybe" : "Decline";
                      const isCurrent = userEmail
                        ? selectedEvent.attendees?.some(
                            (a) =>
                              a.email?.toLowerCase() === userEmail && a.responseStatus === resp,
                          )
                        : selectedEvent.attendees?.find((a) => a.responseStatus === resp && !a.organizer);
                      return (
                        <button
                          key={resp}
                          type="button"
                          className="thread-btn-ghost"
                          disabled={respondToEvent.isPending}
                          data-active={isCurrent ? "true" : undefined}
                          style={{
                            fontSize: 12,
                            padding: "5px 10px",
                            opacity: isCurrent ? 1 : 0.7,
                            border: isCurrent ? "1px solid var(--thread-accent-bright, #60a5fa)" : undefined,
                          }}
                          onClick={() => {
                            if (isDemoUser && !isConnected) {
                              setCustomDemoEvents((prev) =>
                                prev.map((e) => {
                                  if (e.id !== selectedEvent.id) return e;
                                  const nextAttendees = (e.attendees || []).map((a) => {
                                    const isUser = userEmail ? a.email?.toLowerCase() === userEmail : !a.organizer;
                                    if (isUser) {
                                      return { ...a, responseStatus: resp };
                                    }
                                    return a;
                                  });
                                  const updatedEvent = { ...e, attendees: nextAttendees };
                                  setSelectedEvent(updatedEvent);
                                  return updatedEvent;
                                })
                              );
                              toast.success("RSVP updated");
                              return;
                            }
                            respondToEvent.mutate({ eventId: selectedEvent.id, response: resp });
                          }}
                        >
                          <Icon size={12} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <ul className="thread-cal-event-actions-legend">
                <li>
                  <strong>Reschedule</strong> — queue new dates; nothing changes until you approve.
                </li>
                <li>
                  <strong>Delete</strong> — queue removal; nothing is deleted until you approve in
                  Queue.
                </li>
              </ul>
              <div className="thread-modal-row" style={{ marginTop: 8 }}>
                <div>
                  <label className="thread-set-label" htmlFor="reschedule-start">
                    New start
                  </label>
                  <input
                    id="reschedule-start"
                    className="thread-set-input"
                    type={selectedEvent.allDay ? "date" : "datetime-local"}
                    value={rescheduleStart}
                    onChange={(event) => setRescheduleStart(event.target.value)}
                  />
                </div>
                <div>
                  <label className="thread-set-label" htmlFor="reschedule-end">
                    New end
                  </label>
                  <input
                    id="reschedule-end"
                    className="thread-set-input"
                    type={selectedEvent.allDay ? "date" : "datetime-local"}
                    value={rescheduleEnd}
                    onChange={(event) => setRescheduleEnd(event.target.value)}
                  />
                </div>
              </div>
              {selectedEvent.htmlLink ? (
                <a
                  href={selectedEvent.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="thread-cal-event-open"
                >
                  <ExternalLink size={13} />
                  Open in Google Calendar
                </a>
              ) : null}
            </div>
            <div className="thread-modal-actions">
              <button
                type="button"
                className="thread-btn-ghost"
                disabled={eventBusy}
                onClick={() => {
                  try {
                    const when = selectedEvent.allDay
                      ? {
                          startDateTime: rescheduleStart || selectedEvent.start?.slice(0, 10) || "",
                          endDateTime: rescheduleEnd || selectedEvent.end?.slice(0, 10) || "",
                          timeZone: "UTC",
                        }
                      : localDateTimeRangeToPayload(
                          rescheduleStart || isoToLocalDateTimeInput(selectedEvent.start),
                          rescheduleEnd || isoToLocalDateTimeInput(selectedEvent.end),
                        );
                    if (isDemoUser && !isConnected) {
                      setCustomDemoEvents((prev) =>
                        prev.map((e) =>
                          e.id === selectedEvent.id
                            ? { ...e, start: when.startDateTime, end: when.endDateTime }
                            : e
                        )
                      );
                      setSelectedEvent(null);
                      toast.success("Event rescheduled in preview");
                      return;
                    }

                    queueArchive.mutate({
                      archive: {
                        ...eventToArchivePayload(selectedEvent, { editScope: recurringEditScope }),
                        startDateTime: when.startDateTime,
                        endDateTime: when.endDateTime,
                        timeZone: when.timeZone,
                        allDay: selectedEvent.allDay || undefined,
                      },
                      title: `Reschedule: ${selectedEvent.summary}`,
                    });
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Please review your dates");
                  }
                }}
              >
                <ListChecks size={14} />
                {queueArchive.isPending ? "Queuing…" : "Reschedule"}
              </button>
              <button
                type="button"
                className="thread-btn-ghost"
                disabled={eventBusy}
                onClick={() => setShowCancelConfirm(true)}
              >
                <XCircle size={14} />
                Cancel
              </button>
              <button
                type="button"
                className="thread-btn-ghost thread-cal-event-delete"
                disabled={eventBusy}
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDeleteConfirm && selectedEvent ? (
        <div
          className="thread-modal-backdrop thread-modal-backdrop--confirm"
          onClick={() => !queueDelete.isPending && setShowDeleteConfirm(false)}
        >
          <div
            className="thread-modal thread-cal-delete-modal thread-cal-confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="thread-modal-head">
              <h3>Queue delete?</h3>
              <button
                type="button"
                className="thread-app-iconbtn"
                disabled={queueDelete.isPending}
                onClick={() => setShowDeleteConfirm(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="thread-cal-event-detail">
              <p className="thread-cal-confirm-title">{selectedEvent.summary}</p>
              <p className="thread-cal-event-detail-copy">
                This adds a delete request to your approval queue. The event stays on Google Calendar
                until you approve.
                {selectedEvent.isRecurring ? (
                  <>
                    {" "}
                    {recurringEditScope === "series"
                      ? "Approving removes the entire recurring series."
                      : recurringEditScope === "following"
                        ? "Approving removes this and all future occurrences."
                        : "Approving removes only this occurrence."}
                  </>
                ) : null}
              </p>
              {selectedEvent.isRecurring ? (
                <div className="thread-cal-recurring-scope" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="thread-set-label">Delete scope</span>
                  <label className="thread-cal-scope-option" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="radio"
                      name="recurring-delete-scope"
                      checked={recurringEditScope === "instance"}
                      onChange={() => setRecurringEditScope("instance")}
                    />
                    This event only
                  </label>
                  <label className="thread-cal-scope-option" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="radio"
                      name="recurring-delete-scope"
                      checked={recurringEditScope === "series"}
                      onChange={() => setRecurringEditScope("series")}
                    />
                    All events in the series
                  </label>
                  <label className="thread-cal-scope-option" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="radio"
                      name="recurring-delete-scope"
                      checked={recurringEditScope === "following"}
                      onChange={() => setRecurringEditScope("following")}
                    />
                    This and following events
                  </label>
                </div>
              ) : null}
            </div>
            <div className="thread-modal-actions">
              <button
                type="button"
                className="thread-btn-ghost"
                disabled={queueDelete.isPending}
                onClick={() => setShowDeleteConfirm(false)}
              >
                Keep event
              </button>
              <button
                type="button"
                className="thread-btn-accent thread-cal-event-delete-confirm"
                disabled={queueDelete.isPending}
                onClick={() => {
                  if (isDemoUser && !isConnected) {
                    setCustomDemoEvents((prev) => prev.filter((e) => e.id !== selectedEvent.id));
                    setSelectedEvent(null);
                    setShowDeleteConfirm(false);
                    toast.success("Event deleted from preview");
                    return;
                  }
                  queueDelete.mutate({
                    delete: eventToDeletePayload(selectedEvent, { editScope: recurringEditScope }),
                    title: `Delete: ${selectedEvent.summary}`,
                  });
                }}
              >
                <Trash2 size={14} />
                {queueDelete.isPending ? "Queuing…" : "Add to queue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCancelConfirm && selectedEvent ? (
        <div
          className="thread-modal-backdrop thread-modal-backdrop--confirm"
          onClick={() => !queueDelete.isPending && setShowCancelConfirm(false)}
        >
          <div
            className="thread-modal thread-cal-delete-modal thread-cal-confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="thread-modal-head">
              <h3>Queue cancellation?</h3>
              <button
                type="button"
                className="thread-app-iconbtn"
                disabled={queueDelete.isPending}
                onClick={() => setShowCancelConfirm(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="thread-cal-event-detail">
              <p className="thread-cal-confirm-title">{selectedEvent.summary}</p>
              <p className="thread-cal-event-detail-copy">
                Cancels the event and notifies attendees after you approve in Queue. The event stays until approved.
              </p>
            </div>
            <div className="thread-modal-actions">
              <button
                type="button"
                className="thread-btn-ghost"
                disabled={queueDelete.isPending}
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep event
              </button>
              <button
                type="button"
                className="thread-btn-accent"
                disabled={queueDelete.isPending}
                onClick={() => {
                  if (isDemoUser && !isConnected) {
                    setCustomDemoEvents((prev) => prev.filter((e) => e.id !== selectedEvent.id));
                    setSelectedEvent(null);
                    setShowCancelConfirm(false);
                    toast.success("Event cancelled and removed from preview");
                    return;
                  }
                  queueDelete.mutate({
                    delete: {
                      ...eventToDeletePayload(selectedEvent, { editScope: recurringEditScope }),
                      cancelWithNotify: true,
                    },
                    title: `Cancel: ${selectedEvent.summary}`,
                  });
                }}
              >
                <XCircle size={14} />
                {queueDelete.isPending ? "Queuing…" : "Add to queue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {queueAction ? (
        <div
          className="thread-modal-backdrop thread-modal-backdrop--confirm"
          onClick={() => !dismissQueueItem.isPending && !approveQueueItem.isPending && setQueueAction(null)}
        >
          <div className="thread-modal thread-cal-confirm-modal" onClick={(event) => event.stopPropagation()}>
            {(() => {
              const isProcessing = queueAction.item.status === "processing";
              return (
                <>
            <div className="thread-modal-head">
              <h3>
                {isProcessing
                  ? "Processing…"
                  : queueAction.item.kind === "calendar_delete"
                  ? "Delete queued"
                  : queueAction.item.kind === "calendar_archive"
                    ? "Reschedule pending"
                    : "Queued on calendar"}
              </h3>
              <button
                type="button"
                className="thread-app-iconbtn"
                disabled={dismissQueueItem.isPending || approveQueueItem.isPending}
                onClick={() => setQueueAction(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="thread-cal-event-detail">
              <p className="thread-cal-confirm-title">{queueAction.event.summary}</p>
              <p className="thread-cal-event-detail-copy">
                {isProcessing
                  ? "This item is being processed. You can cancel it if it appears stuck."
                  : queueAction.item.kind === "calendar_delete"
                  ? "Approve to remove this event from Google Calendar. Cancel request keeps the event and removes the dashed overlay."
                  : queueAction.item.kind === "calendar_invite" || queueAction.item.kind === "meeting_bundle"
                    ? "This invite is only queued — it is not on Google Calendar yet. Cancel removes it from this preview."
                    : "Review this queued calendar change in Queue or take action here."}
              </p>
            </div>
            <div className="thread-modal-actions">
              <button
                type="button"
                className="thread-btn-ghost"
                disabled={dismissQueueItem.isPending || approveQueueItem.isPending}
                onClick={() => dismissQueueItem.mutate({ id: queueAction.item.id })}
              >
                {isProcessing
                  ? "Cancel processing"
                  : queueAction.item.kind === "calendar_delete"
                    ? "Cancel delete"
                    : "Remove from queue"}
              </button>
              <button
                type="button"
                className="thread-btn-ghost"
                disabled={dismissQueueItem.isPending || approveQueueItem.isPending}
                onClick={() => {
                  setQueueAction(null);
                  router.push("/queue");
                }}
              >
                Open Queue
              </button>
              <button
                type="button"
                className="thread-btn-accent"
                disabled={isProcessing || dismissQueueItem.isPending || approveQueueItem.isPending}
                onClick={() => approveQueueItem.mutate({ id: queueAction.item.id })}
              >
                {approveQueueItem.isPending ? "Approving…" : "Approve"}
              </button>
            </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {demoModal}
    </div>
  );
}
