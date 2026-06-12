"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  Calendar as CalIcon,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListChecks,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import {
  eventDayKey,
  eventToArchivePayload,
  localDateTimeInputToPayload,
  localDateTimeRangeToPayload,
  localDayKey,
  toLocalDateTimeInput,
} from "~/lib/calendar-datetime";

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
  htmlLink?: string;
  status?: string;
  pending?: boolean;
  pendingArchive?: boolean;
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
    staleTime: 0,
  });

  const pendingQueue = trpc.queue.list.useQuery({ status: "pending" }, { enabled: isConnected });

  const queueInvite = trpc.queue.enqueueCalendar.useMutation({
    onSuccess: async () => {
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      toast.success("Invite queued — approve from Queue to add to Google Calendar");
      setShowCreate(false);
      setSummary("");
      setAttendee("");
    },
    onError: (error) => toast.error(error.message),
  });

  const refreshEvents = async () => {
    await utils.calendar.listEvents.invalidate();
    await eventsQuery.refetch();
  };

  const queueArchive = trpc.queue.enqueueCalendarArchive.useMutation({
    onSuccess: async () => {
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      setSelectedEvent(null);
      toast.success("Archive request queued — confirm dates in Queue");
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteEvent = trpc.calendar.deleteEvent.useMutation({
    onSuccess: async () => {
      await refreshEvents();
      setSelectedEvent(null);
      setShowDeleteConfirm(false);
      toast.success("Event deleted from Google Calendar");
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
        const summary = String(payload.summary ?? item.title.replace(/^Archive:\s*/i, ""));
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

  const eventBusy = queueArchive.isPending || deleteEvent.isPending;

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
        <div className="thread-empty-inbox" style={{ marginTop: 24 }}>
          <Loader2 size={18} className="thread-spin" />
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--thread-dim)" }}>Loading events…</p>
        </div>
      ) : (
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
                        onClick={() => {
                          if (event.pending || event.pendingArchive) {
                            router.push("/queue");
                            return;
                          }
                          setSelectedEvent(event);
                        }}
                      >
                        <span className="thread-cal-event-time">
                          {event.pendingArchive
                            ? "Review pending · "
                            : event.pending
                              ? "Queued · "
                              : ""}
                          {formatEventTime(event.start)}
                        </span>
                        <span className="thread-cal-event-title">{event.summary}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
                  const when = localDateTimeRangeToPayload(startAt, endAt);
                  queueInvite.mutate({
                  calendar: {
                    summary,
                    description: "Scheduled from Thread calendar.",
                    startDateTime: when.startDateTime,
                    endDateTime: when.endDateTime,
                    timeZone: when.timeZone,
                    attendeeEmails: attendee.trim() ? [attendee.trim()] : undefined,
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
                    onChange={(event) => setEndAt(event.target.value)}
                    required
                  />
                </div>
              </div>

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
                className="thread-app-iconbtn"
                disabled={eventBusy}
                onClick={() => setSelectedEvent(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="thread-cal-event-detail">
              <p className="thread-cal-event-when">
                {formatEventWhen(selectedEvent.start, selectedEvent.end)}
              </p>
              <p className="thread-cal-event-detail-copy">
                Archive request sends this to the approval queue so you can confirm dates before
                anything changes. Delete permanently removes it from Google Calendar.
              </p>
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
                onClick={() =>
                  queueArchive.mutate({
                    archive: eventToArchivePayload(selectedEvent),
                    title: `Archive: ${selectedEvent.summary}`,
                  })
                }
              >
                <Archive size={14} />
                {queueArchive.isPending ? "Queuing…" : "Archive request"}
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
          onClick={() => !deleteEvent.isPending && setShowDeleteConfirm(false)}
        >
          <div
            className="thread-modal thread-cal-delete-modal thread-cal-confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="thread-modal-head">
              <h3>Delete event?</h3>
              <button
                type="button"
                className="thread-app-iconbtn"
                disabled={deleteEvent.isPending}
                onClick={() => setShowDeleteConfirm(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="thread-cal-event-detail">
              <p className="thread-cal-confirm-title">{selectedEvent.summary}</p>
              <p className="thread-cal-event-detail-copy">
                This permanently removes the event from Google Calendar. This cannot be undone.
              </p>
            </div>
            <div className="thread-modal-actions">
              <button
                type="button"
                className="thread-btn-ghost"
                disabled={deleteEvent.isPending}
                onClick={() => setShowDeleteConfirm(false)}
              >
                Keep event
              </button>
              <button
                type="button"
                className="thread-btn-accent thread-cal-event-delete-confirm"
                disabled={deleteEvent.isPending}
                onClick={() => deleteEvent.mutate({ eventId: selectedEvent.id })}
              >
                <Trash2 size={14} />
                {deleteEvent.isPending ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
