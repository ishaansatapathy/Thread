"use client";

import { Calendar as CalIcon, ChevronLeft, ChevronRight } from "lucide-react";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeek() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export default function CalendarPage() {
  const week = getWeek();
  const todayKey = new Date().toDateString();
  const monthLabel = week[0]!.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div>
      <div className="thread-app-banner">
        <div className="thread-app-banner-icon">
          <CalIcon size={18} />
        </div>
        <div className="thread-app-banner-text">
          <h4>Calendar not connected</h4>
          <p>Connect Google Calendar via Corsair to see events and queue invites for one-tap approval.</p>
        </div>
        <a href="/api-auth/google?state=/calendar" className="thread-btn-accent">
          Connect
        </a>
      </div>

      <div className="thread-cal-head">
        <button type="button" className="thread-app-iconbtn" aria-label="Previous week">
          <ChevronLeft size={15} />
        </button>
        <button type="button" className="thread-app-iconbtn" aria-label="Next week">
          <ChevronRight size={15} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, marginLeft: 4 }}>{monthLabel}</span>
        <span className="thread-mono-tag" style={{ marginLeft: "auto" }}>
          This week
        </span>
      </div>

      <div className="thread-cal-grid">
        {week.map((d) => {
          const isToday = d.toDateString() === todayKey;
          return (
            <div key={d.toISOString()} className="thread-cal-col">
              <div className="thread-cal-colhead" data-today={isToday}>
                <div className="thread-cal-dow">{DOW[(d.getDay() + 6) % 7]}</div>
                <div className="thread-cal-dom" data-today={isToday}>
                  {d.getDate()}
                </div>
              </div>
              <div className="thread-cal-body">
                {isToday && <div className="thread-cal-empty-note">No events — connect Calendar to sync</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
