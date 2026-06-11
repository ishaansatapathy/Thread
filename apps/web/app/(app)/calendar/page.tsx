"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Calendar as CalIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  X,
} from "lucide-react";

import { trpc } from "~/trpc/client";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatEventTime(value?: string) {
  if (!value) return "";
  if (value.length === 10) return "All day";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function toLocalDateTimeInput(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function CalendarPage() {
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [summary, setSummary] = useState("");
  const [attendee, setAttendee] = useState("");
  const [startAt, setStartAt] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 86_400_000)));
  const [endAt, setEndAt] = useState(() =>
    toLocalDateTimeInput(new Date(Date.now() + 86_400_000 + 3_600_000)),
  );

  const week = useMemo(() => getWeekDays(weekAnchor), [weekAnchor]);
  const timeMin = week[0]!.toISOString();
  const timeMax = new Date(week[6]!.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
  const todayKey = dayKey(new Date());
  const monthLabel = week[0]!.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const statusQuery = trpc.calendar.connectionStatus.useQuery({});
  const isConnected = statusQuery.data?.googlecalendar === "connected";
  const connectHref = `/api-connect/calendar?state=${encodeURIComponent("/calendar")}`;

  const eventsQuery = trpc.calendar.listEvents.useQuery(
    { timeMin, timeMax, maxResults: 100 },
    { enabled: isConnected },
  );

  const createEvent = trpc.calendar.createEvent.useMutation({
    onSuccess: async () => {
      await utils.calendar.listEvents.invalidate();
      toast.success("Invite sent on Google Calendar");
      setShowCreate(false);
      setSummary("");
      setAttendee("");
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
    const map = new Map<string, Array<{ id: string; summary: string; start?: string }>>();
    for (const day of week) {
      map.set(dayKey(day), []);
    }
    for (const event of eventsQuery.data?.events ?? []) {
      const key = event.start?.slice(0, 10);
      if (!key || !map.has(key)) continue;
      map.get(key)!.push(event);
    }
    return map;
  }, [eventsQuery.data?.events, week]);

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
            <p className="thread-cal-toolbar-copy">Live events from Google Calendar through Corsair.</p>
          </div>
          <button type="button" className="thread-btn-accent" onClick={() => setShowCreate(true)}>
            <Plus size={14} />
            New invite
          </button>
        </div>
      )}

      {banner ? (
        <div className="thread-inbox-banner" data-variant={banner.type} style={{ margin: "12px 0 0" }}>
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
            const key = dayKey(day);
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
                      <div key={event.id} className="thread-cal-event">
                        <span className="thread-cal-event-time">{formatEventTime(event.start)}</span>
                        <span className="thread-cal-event-title">{event.summary}</span>
                      </div>
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
              <button type="button" className="thread-app-iconbtn" onClick={() => setShowCreate(false)}>
                <X size={14} />
              </button>
            </div>
            <form
              className="thread-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                createEvent.mutate({
                  summary,
                  startDateTime: new Date(startAt).toISOString(),
                  endDateTime: new Date(endAt).toISOString(),
                  attendeeEmails: attendee.trim() ? [attendee.trim()] : undefined,
                });
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
                <button type="button" className="thread-btn-ghost" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="thread-btn-accent" disabled={createEvent.isPending}>
                  {createEvent.isPending ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
