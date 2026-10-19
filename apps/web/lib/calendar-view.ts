export type CalendarViewMode = "day" | "week" | "month";

export type CalendarGridDay = {
  date: Date;
  inMonth: boolean;
};

export function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + mondayOffset);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Whole calendar days from `from` to `to` (DST-safe). */
export function dayDiff(from: Date, to: Date) {
  const a = startOfDay(from);
  const b = startOfDay(to);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function getDaysFrom(start: Date, count: number) {
  const first = startOfDay(start);
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

/** Week view is a rolling 7-day window that starts on the anchor day. */
export function getWeekDays(anchor: Date) {
  return getDaysFrom(anchor, 7);
}

/** Days rendered in the horizontally scrollable week strip. */
export const WEEK_STRIP_DAYS = 35;
/** How many days before the visible window the strip starts. */
export const WEEK_STRIP_LEAD = 14;

export function weekStripStartFor(windowStart: Date) {
  return addDays(startOfDay(windowStart), -WEEK_STRIP_LEAD);
}

export function boundsForDays(days: Date[]) {
  const start = startOfDay(days[0]!);
  const end = startOfDay(days[days.length - 1]!);
  end.setHours(23, 59, 59, 999);
  const pad = 24 * 60 * 60 * 1000;
  return {
    timeMin: new Date(start.getTime() - pad).toISOString(),
    timeMax: new Date(end.getTime() + pad).toISOString(),
  };
}

/** Standard 6-row month grid (Mon–Sun), including leading/trailing days. */
export function getMonthGridDays(anchor: Date): CalendarGridDay[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return { date, inMonth: date.getMonth() === month };
  });
}

export function getVisibleDays(mode: CalendarViewMode, anchor: Date): CalendarGridDay[] {
  if (mode === "day") {
    const date = new Date(anchor);
    date.setHours(0, 0, 0, 0);
    return [{ date, inMonth: true }];
  }
  if (mode === "week") {
    return getWeekDays(anchor).map((date) => ({ date, inMonth: true }));
  }
  return getMonthGridDays(anchor);
}

export function queryBoundsForView(mode: CalendarViewMode, anchor: Date) {
  return boundsForDays(getVisibleDays(mode, anchor).map((day) => day.date));
}

export function navigateAnchor(mode: CalendarViewMode, anchor: Date, direction: -1 | 1) {
  const next = new Date(anchor);
  if (mode === "day") {
    next.setDate(next.getDate() + direction);
  } else if (mode === "week") {
    next.setDate(next.getDate() + direction * 7);
  } else {
    next.setMonth(next.getMonth() + direction, 1);
  }
  return next;
}

export function viewPeriodLabel(mode: CalendarViewMode, anchor: Date) {
  if (mode === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (mode === "week") {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).formatRange(
      startOfDay(anchor),
      addDays(startOfDay(anchor), 6),
    );
  }
  return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function prevNextAriaLabel(mode: CalendarViewMode, direction: -1 | 1) {
  const word = direction === -1 ? "Previous" : "Next";
  if (mode === "day") return `${word} day`;
  if (mode === "week") return `${word} week`;
  return `${word} month`;
}
