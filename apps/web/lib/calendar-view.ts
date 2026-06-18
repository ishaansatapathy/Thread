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

export function getWeekDays(anchor: Date) {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return day;
  });
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
  const days = getVisibleDays(mode, anchor);
  const start = new Date(days[0]!.date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(days[days.length - 1]!.date);
  end.setHours(23, 59, 59, 999);
  const pad = 24 * 60 * 60 * 1000;
  return {
    timeMin: new Date(start.getTime() - pad).toISOString(),
    timeMax: new Date(end.getTime() + pad).toISOString(),
  };
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
  return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function prevNextAriaLabel(mode: CalendarViewMode, direction: -1 | 1) {
  const word = direction === -1 ? "Previous" : "Next";
  if (mode === "day") return `${word} day`;
  if (mode === "week") return `${word} week`;
  return `${word} month`;
}
