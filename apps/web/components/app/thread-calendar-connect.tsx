"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, ChevronDown, Loader2, Plus, Settings2 } from "lucide-react";

import { trpc } from "~/trpc/client";

export function ThreadCalendarConnect() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const statusQuery = trpc.calendar.connectionStatus.useQuery({});

  const connectHref = `/api-connect/calendar?state=${encodeURIComponent(pathname || "/calendar")}`;
  const calendarStatus = statusQuery.data?.googlecalendar ?? "not_configured";
  const isConnected = calendarStatus === "connected";
  const isLoading = statusQuery.isLoading;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (isLoading) {
    return (
      <span className="thread-gmail-connect thread-gmail-connect--loading" aria-label="Checking Calendar">
        <Loader2 size={14} className="thread-spin" />
      </span>
    );
  }

  if (!isConnected) {
    return (
      <a href={connectHref} className="thread-btn-ghost" style={{ fontSize: 13, padding: "8px 14px" }}>
        <Calendar size={14} />
        Connect Calendar
      </a>
    );
  }

  return (
    <div className="thread-gmail-connect" ref={rootRef}>
      <button
        type="button"
        className="thread-gmail-connect-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="thread-gmail-connect-dot" aria-hidden />
        <Calendar size={14} />
        <span>Calendar</span>
        <span className="thread-gmail-connect-label">Connected</span>
        <ChevronDown size={14} className="thread-gmail-connect-chevron" data-open={open} />
      </button>

      {open ? (
        <div className="thread-gmail-connect-menu" role="menu">
          <div className="thread-gmail-connect-menu-head">
            <span className="thread-gmail-connect-menu-title">Primary calendar</span>
            <span className="thread-gmail-connect-menu-badge">Active</span>
          </div>
          <p className="thread-gmail-connect-menu-copy">
            Events sync through Corsair. Invites send with Google Calendar.
          </p>
          <div className="thread-gmail-connect-menu-sep" />
          <a
            href={connectHref}
            className="thread-app-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Plus size={14} />
            Reconnect Calendar
          </a>
          <Link
            href="/settings"
            className="thread-app-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Settings2 size={14} />
            Manage connections
          </Link>
        </div>
      ) : null}
    </div>
  );
}
