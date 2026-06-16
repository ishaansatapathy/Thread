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
import { SkeletonList } from "~/components/app/skeleton-list";
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

function weekQueryBounds(week: Date[]) {
  const start = new Date(week[0]!);
  start.setHours(0, 0, 0, 0);
  const end = new Date(week[6]!);
  end.setHours(23, 59, 59, 999);
  const pad = 24 * 60 * 60 * 1000;
  return {
    timeMin: new Date(start.getTime() - pad).toISOString(),
    timeMax: new Date(end.getTime() + pad).toISOString(),
  };
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + mondayOffset);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getWeekDays(anchor: Date) {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return day;
  });
}

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

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
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

  const week = useMemo(() => getWeekDays(weekAnchor), [weekAnchor]);
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const eventQuery = useMemo(() => {
    const bounds = weekQueryBounds(week);
    return { ...bounds, maxResults: 100, timeZone: browserTimeZone };
  }, [week, browserTimeZone]);
  const todayKey = localDayKey(new Date());
  const monthLabel = week[0]!.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const statusQuery = trpc.calendar.connectionStatus.useQuery({});
  const isConnected = statusQuery.data?.googlecalendar === "connected";
  const connectHref = `/api-connect/calendar?state=${encodeURIComponent("/calendar")}`;

  const eventsQuery = trpc.calendar.listEvents.useQuery(eventQuery, {
    enabled: isConnected,
    refetchOnMount: "always",
    refetchInterval: isConnected ? 30_000 : false,
    staleTime: 0,
  });

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

  const pendingQueue = trpc.queue.list.useQuery({ status: "pending" }, { enabled: isConnected });

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
      toast.success(queueResultMessage(item).title);
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
        if (found.start) setWeekAnchor(startOfWeek(new Date(found.start)));
        setSelectedEvent(found as CalendarEventItem);
        setShowPrep(true);
      }
      setDeepLinkSearched(true);
    }
  }, [searchParams, eventsQuery.data, wideEventsQuery.data]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const day of week) {
      map.set(localDayKey(day), []);
    }
    for (const event of eventsQuery.data?.events ?? []) {
      if (event.status?.toLowerCase() === "cancelled") continue;
      const key = eventDayKey(event.start);
      if (!key || !map.has(key)) continue;
      map.get(key)!.push(event);
    }
    for (const item of pendingQueue.data?.items ?? []) {
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
  }, [eventsQuery.data?.events, pendingQueue.data?.items, week]);

  const eventBusy = queueArchive.isPending || queueDelete.isPending;

  const mobileWeekEvents = useMemo(() => {
    const items: CalendarEventItem[] = [];
    for (const day of week) {
      const key = localDayKey(day);
      for (const event of eventsByDay.get(key) ?? []) {
        items.push(event);
      }
    }
    return items;
  }, [week, eventsByDay]);

  return (
    <div>
      {!isConnected ? (
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
        <div className="thread-cal-toolbar">
          <div>
            <h3 className="thread-cal-toolbar-title">Your schedule</h3>
            <p className="thread-cal-toolbar-copy">
              Live events from Google Calendar. Dashed blocks are queued — approve in Queue to
              publish.
            </p>
          </div>
          <button type="button" className="thread-btn-accent" onClick={() => setShowCreate(true)}>
            <Plus size={14} />
            New invite
          </button>
        </div>
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
          aria-label="Previous week"
          onClick={() => {
            const next = new Date(weekAnchor);
            next.setDate(next.getDate() - 7);
            setWeekAnchor(next);
          }}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="thread-app-iconbtn"
          aria-label="Next week"
          onClick={() => {
            const next = new Date(weekAnchor);
            next.setDate(next.getDate() + 7);
            setWeekAnchor(next);
          }}
        >
          <ChevronRight size={15} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, marginLeft: 4 }}>{monthLabel}</span>
        <button
          type="button"
          className="thread-btn-ghost"
          style={{ marginLeft: "auto", fontSize: 12, padding: "6px 12px" }}
          disabled={eventsQuery.isFetching}
          onClick={() => void refreshEvents()}
        >
          {eventsQuery.isFetching ? "Refreshing…" : "Refresh"}
        </button>
        <button
          type="button"
          className="thread-btn-ghost"
          style={{ fontSize: 12, padding: "6px 12px" }}
          onClick={() => setWeekAnchor(new Date())}
        >
          Today
        </button>
      </div>

      {eventsQuery.isLoading && isConnected ? (
        <SkeletonList count={7} />
      ) : (
        <>
        <div className="thread-cal-mobile-list">
          {mobileWeekEvents.length === 0 ? (
            <div className="thread-cal-empty-note">No events this week</div>
          ) : (
            mobileWeekEvents.map((event) => (
              <button
                key={`mobile-${event.id}`}
                type="button"
                className="thread-cal-mobile-item"
                onClick={() => {
                  if (event.pending || event.pendingArchive || event.pendingDelete) {
                    router.push("/queue");
                    return;
                  }
                  setSelectedEvent(event);
                  setShowPrep(false);
                }}
              >
                <span className="thread-cal-mobile-item-when">
                  {formatEventWhen(event.start, event.end)}
                </span>
                <span className="thread-cal-mobile-item-title">{event.summary}</span>
              </button>
            ))
          )}
        </div>
        <div className="thread-cal-grid">
          {week.map((day) => {
            const key = localDayKey(day);
            const isToday = key === todayKey;
            const dayEvents = eventsByDay.get(key) ?? [];
            return (
              <div key={day.toISOString()} className="thread-cal-col">
                <div className="thread-cal-colhead" data-today={isToday}>
                  <div className="thread-cal-dow">{DOW[(day.getDay() + 6) % 7]}</div>
                  <div className="thread-cal-dom" data-today={isToday}>
                    {day.getDate()}
                  </div>
                </div>
                <div className="thread-cal-body">
                  {!isConnected ? (
                    <div className="thread-cal-empty-note">Connect Calendar to sync</div>
                  ) : dayEvents.length === 0 ? (
                    <div className="thread-cal-empty-note">No events</div>
                  ) : (
                    dayEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className="thread-cal-event"
                        data-selected={selectedEvent?.id === event.id}
                        data-pending={event.pending ? "true" : undefined}
                        data-pending-archive={event.pendingArchive ? "true" : undefined}
                        data-pending-delete={event.pendingDelete ? "true" : undefined}
                        onClick={() => {
                          if (event.pending || event.pendingArchive || event.pendingDelete) {
                            router.push("/queue");
                            return;
                          }
                          setSelectedEvent(event);
                          setShowPrep(false);
                        }}
                      >
                        <span className="thread-cal-event-time">
                          {event.pendingArchive
                            ? "Review pending · "
                            : event.pendingDelete
                              ? "Delete queued · "
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
                    ))
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
                      const isCurrent = selectedEvent.attendees?.find((a) => a.responseStatus === resp && !a.organizer);
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
                          onClick={() => respondToEvent.mutate({ eventId: selectedEvent.id, response: resp })}
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
                onClick={() =>
                  queueDelete.mutate({
                    delete: eventToDeletePayload(selectedEvent, { editScope: recurringEditScope }),
                    title: `Delete: ${selectedEvent.summary}`,
                  })
                }
              >
                <Trash2 size={14} />
                {queueDelete.isPending ? "Queuing…" : "Add to queue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
