"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, Loader2, Mail, Paperclip, Search } from "lucide-react";

import { trpc } from "~/trpc/client";
import type { AgentFocusState } from "./agent-focus-chip";

type AgentContextPickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (focus: AgentFocusState) => void;
  disabled?: boolean;
};

type PickerTab = "inbox" | "calendar";

function calendarPickerBounds() {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 7);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 30);
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: 12,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function AgentContextPicker({ open, onClose, onSelect, disabled }: AgentContextPickerProps) {
  const [tab, setTab] = useState<PickerTab>("inbox");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setTab("inbox");
    }
  }, [open]);

  const inboxQuery = trpc.inbox.listThreads.useQuery(
    { maxResults: 12, query: query.trim() || undefined },
    { enabled: open && tab === "inbox", staleTime: 30_000 },
  );

  const calendarQuery = trpc.calendar.listEvents.useQuery(
    { ...calendarPickerBounds(), q: query.trim() || undefined },
    { enabled: open && tab === "calendar", staleTime: 30_000 },
  );

  const threads = useMemo(() => inboxQuery.data?.threads ?? [], [inboxQuery.data]);
  const events = useMemo(() => calendarQuery.data?.events ?? [], [calendarQuery.data]);
  const loading = tab === "inbox" ? inboxQuery.isLoading : calendarQuery.isLoading;

  if (!open) return null;

  return (
    <div className="thread-agent-context-picker" role="dialog" aria-label="Attach context">
      <div className="thread-agent-context-picker-head">
        <Paperclip size={14} />
        <span>Attach context</span>
        <button type="button" className="thread-agent-context-picker-close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="thread-agent-context-picker-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inbox"}
          data-active={tab === "inbox" ? "true" : undefined}
          onClick={() => setTab("inbox")}
        >
          <Mail size={13} />
          Inbox
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "calendar"}
          data-active={tab === "calendar" ? "true" : undefined}
          onClick={() => setTab("calendar")}
        >
          <Calendar size={13} />
          Calendar
        </button>
      </div>

      <div className="thread-agent-context-picker-search">
        <Search size={13} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "inbox" ? "Search threads…" : "Search events…"}
          disabled={disabled}
        />
      </div>

      <ul className="thread-agent-context-picker-list" role="listbox">
        {loading ? (
          <li className="thread-agent-context-picker-empty">
            <Loader2 size={14} className="thread-spin" />
            Loading…
          </li>
        ) : tab === "inbox" ? (
          threads.length === 0 ? (
            <li className="thread-agent-context-picker-empty">No threads found</li>
          ) : (
            threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className="thread-agent-context-picker-item"
                  disabled={disabled}
                  onClick={() => {
                    onSelect({
                      threadId: thread.id,
                      threadLabel: thread.subject?.trim() || thread.fromName || thread.from || "Email thread",
                      eventId: undefined,
                      eventLabel: undefined,
                    });
                    onClose();
                  }}
                >
                  <Mail size={13} />
                  <span className="thread-agent-context-picker-item-main">
                    <strong>{thread.subject?.trim() || "(no subject)"}</strong>
                    <span>{thread.fromName || thread.from || "Unknown sender"}</span>
                  </span>
                </button>
              </li>
            ))
          )
        ) : events.length === 0 ? (
          <li className="thread-agent-context-picker-empty">No events found</li>
        ) : (
          events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                className="thread-agent-context-picker-item"
                disabled={disabled}
                onClick={() => {
                  onSelect({
                    eventId: event.id,
                    eventLabel: event.summary?.trim() || "Calendar event",
                    threadId: undefined,
                    threadLabel: undefined,
                  });
                  onClose();
                }}
              >
                <Calendar size={13} />
                <span className="thread-agent-context-picker-item-main">
                  <strong>{event.summary?.trim() || "(no title)"}</strong>
                  <span>{event.start ? new Date(event.start).toLocaleString() : "No start time"}</span>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
