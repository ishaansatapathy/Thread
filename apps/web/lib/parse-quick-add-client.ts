export type ParsedQuickAdd = {
  summary: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  allDay: boolean;
};

const DEFAULT_TIME_ZONE = "Asia/Kolkata";

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function monthIndex(token: string): number | null {
  const key = token.toLowerCase().replace(/\./g, "");
  return MONTHS[key] ?? null;
}

function parseClockToken(raw: string): { hour: number; minute: number } | null {
  const token = raw.trim().toLowerCase();
  if (token === "noon") return { hour: 12, minute: 0 };
  if (token === "midnight") return { hour: 0, minute: 0 };

  const match = token.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hour = Number.parseInt(match[1] ?? "0", 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  const ampm = match[3]?.toLowerCase();

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (!ampm && hour <= 7) hour += 12; // bare "5" in meeting context -> evening

  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function stripOnce(text: string, pattern: RegExp | string) {
  const next = text.replace(pattern, " ").replace(/\s+/g, " ").trim();
  return next;
}

function stripActionPrefix(text: string): { rest: string; defaultTitle?: string } {
  const meeting = text.match(
    /^(please\s+)?(add|create|schedule|book|set up)\s+(an?\s+)?(calendar\s+)?(meeting|call|appointment|event|invite)\b[:\s-]*/i,
  );
  if (meeting) {
    const kind = meeting[5]?.toLowerCase();
    const title =
      kind === "call" ? "Call" : kind === "appointment" ? "Appointment" : kind === "invite" ? "Invite" : "Meeting";
    return { rest: text.slice(meeting[0].length).trim(), defaultTitle: title };
  }

  const eventOnly = text.match(
    /^(please\s+)?(add|create|schedule|book)\s+(an?\s+)?(calendar\s+)?event\s+(on|for|at|from)\s+/i,
  );
  if (eventOnly) {
    return { rest: text.slice(eventOnly[0].length).trim(), defaultTitle: "Event" };
  }

  return { rest: text };
}

function parseTimeRange(text: string): {
  start: { hour: number; minute: number };
  end: { hour: number; minute: number };
  rest: string;
} | null {
  const fromTo = text.match(
    /\bfrom\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|noon|midnight)\s*(?:to|-)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|noon|midnight)\b/i,
  );
  if (fromTo) {
    const start = parseClockToken(fromTo[1] ?? "");
    const end = parseClockToken(fromTo[2] ?? "");
    if (start && end) {
      return { start, end, rest: stripOnce(text, fromTo[0]) };
    }
  }

  const compact = text.match(
    /\b([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm))\b/i,
  );
  if (compact) {
    let start = parseClockToken(compact[1] ?? "");
    let end = parseClockToken(compact[2] ?? "");
    if (start && end) {
      const endToken = (compact[2] ?? "").toLowerCase();
      const startToken = (compact[1] ?? "").toLowerCase();
      if (!/(am|pm)/.test(startToken) && /(am|pm)/.test(endToken) && end.hour >= 12 && start.hour <= 12) {
        start = { hour: start.hour + 12, minute: start.minute };
      }
      return { start, end, rest: stripOnce(text, compact[0]) };
    }
  }

  const atTime = text.match(/\bat\s+(noon|midnight|[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\b/i);
  if (atTime) {
    const start = parseClockToken(atTime[1] ?? "");
    if (start) {
      const end = { hour: start.hour + 1, minute: start.minute };
      return { start, end, rest: stripOnce(text, atTime[0]) };
    }
  }

  return null;
}

function resolveDayMonth(day: number, month: number, refDate: Date) {
  let year = refDate.getFullYear();
  const candidate = new Date(year, month, day);
  const todayStart = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  if (candidate < todayStart) year += 1;
  return new Date(year, month, day);
}

function parseDate(text: string, refDate: Date): { date: Date; rest: string } | null {
  if (/\btoday\b/i.test(text)) {
    return { date: new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate()), rest: stripOnce(text, /\btoday\b/i) };
  }
  if (/\btomorrow\b/i.test(text)) {
    const d = new Date(refDate);
    d.setDate(d.getDate() + 1);
    return { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), rest: stripOnce(text, /\btomorrow\b/i) };
  }

  const dayMonth = text.match(
    /\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );
  if (dayMonth) {
    const day = Number.parseInt(dayMonth[1] ?? "", 10);
    const month = monthIndex(dayMonth[2] ?? "");
    if (month !== null && day >= 1 && day <= 31) {
      return {
        date: resolveDayMonth(day, month, refDate),
        rest: stripOnce(text, dayMonth[0]),
      };
    }
  }

  const monthDay = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  if (monthDay) {
    const month = monthIndex(monthDay[1] ?? "");
    const day = Number.parseInt(monthDay[2] ?? "", 10);
    if (month !== null && day >= 1 && day <= 31) {
      return {
        date: resolveDayMonth(day, month, refDate),
        rest: stripOnce(text, monthDay[0]),
      };
    }
  }

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso?.[1]) {
    const [y, m, d] = iso[1].split("-").map(Number);
    return { date: new Date(y!, m! - 1, d), rest: stripOnce(text, iso[0]) };
  }

  const dayOnly = text.match(/\b(?:on\s+(?:the\s+)?)?(\d{1,2})(?:st|nd|rd|th)?(?!\s*(?:am|pm|:|\d))\b/i);
  if (dayOnly) {
    const day = Number.parseInt(dayOnly[1] ?? "", 10);
    if (day >= 1 && day <= 31) {
      return {
        date: resolveDayMonth(day, refDate.getMonth(), refDate),
        rest: stripOnce(text, dayOnly[0]),
      };
    }
  }

  return null;
}

function buildSummary(rest: string, explicit: string | undefined, defaultTitle: string | undefined, fallback: string) {
  if (explicit?.trim()) return explicit.trim();

  const cleaned = rest
    .replace(/\b(on|at|from|to|the|an|a)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned && !/^\d/.test(cleaned) && cleaned.length > 2) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return defaultTitle ?? (fallback.trim() || "Event");
}

function formatClock(hour: number, minute: number) {
  const period = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 || 12;
  if (minute === 0) return `${hour12}${period}`;
  return `${hour12}:${pad2(minute)}${period}`;
}

function formatTimeRangeLabel(range: {
  start: { hour: number; minute: number };
  end: { hour: number; minute: number };
}) {
  return `${formatClock(range.start.hour, range.start.minute)}-${formatClock(range.end.hour, range.end.minute)}`;
}

function buildAllDayQuickAddResult(
  eventDate: Date,
  summary: string,
  timeRange?: {
    start: { hour: number; minute: number };
    end: { hour: number; minute: number };
  } | null,
) {
  let title = summary;
  if (timeRange) {
    const timeLabel = formatTimeRangeLabel(timeRange);
    const lower = title.toLowerCase();
    if (!lower.includes("am") && !lower.includes("pm") && !lower.includes("noon")) {
      title = title ? `${title} (${timeLabel})` : timeLabel;
    }
  }

  const startDate = `${eventDate.getFullYear()}-${pad2(eventDate.getMonth() + 1)}-${pad2(eventDate.getDate())}`;
  const endDateObj = new Date(eventDate);
  endDateObj.setDate(endDateObj.getDate() + 1);
  const endDate = `${endDateObj.getFullYear()}-${pad2(endDateObj.getMonth() + 1)}-${pad2(endDateObj.getDate())}`;

  return {
    summary: title,
    startDateTime: startDate,
    endDateTime: endDate,
    allDay: true as const,
    timeZone: DEFAULT_TIME_ZONE,
  };
}

/** Parse natural-language scheduling text into createEvent fields on the client. */
export function parseQuickAddText(text: string, refDate = new Date()): ParsedQuickAdd {
  const original = text.trim();
  let remaining = original;

  const { rest: afterAction, defaultTitle } = stripActionPrefix(remaining);
  remaining = afterAction;

  const timeRange = parseTimeRange(remaining);
  if (timeRange) remaining = timeRange.rest;

  const parsedDate = parseDate(remaining, refDate);
  if (parsedDate) remaining = parsedDate.rest;
  const eventDate = parsedDate?.date ?? new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());

  let summary = "";
  const forMatch = remaining.match(/\bfor\s+(.+)$/i);
  if (forMatch?.[1]) {
    const raw = forMatch[1].trim();
    summary = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
    remaining = remaining.slice(0, forMatch.index).trim();
  }

  summary = buildSummary(remaining, summary || undefined, defaultTitle, original);

  return buildAllDayQuickAddResult(eventDate, summary, timeRange);
}
