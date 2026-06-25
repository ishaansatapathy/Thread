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

export type ParsedQuickDelete = {
  intent: "delete";
  query?: string;
  onDate?: Date;
  deleteAllOnDate: boolean;
};

function monthIndex(token: string): number | null {
  const key = token.toLowerCase().replace(/\./g, "");
  return MONTHS[key] ?? null;
}

function stripOnce(text: string, pattern: RegExp | string) {
  return text.replace(pattern, " ").replace(/\s+/g, " ").trim();
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
    return {
      date: new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate()),
      rest: stripOnce(text, /\btoday\b/i),
    };
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
      return { date: resolveDayMonth(day, month, refDate), rest: stripOnce(text, dayMonth[0]) };
    }
  }

  const monthDay = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  if (monthDay) {
    const month = monthIndex(monthDay[1] ?? "");
    const day = Number.parseInt(monthDay[2] ?? "", 10);
    if (month !== null && day >= 1 && day <= 31) {
      return { date: resolveDayMonth(day, month, refDate), rest: stripOnce(text, monthDay[0]) };
    }
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

function extractDeleteQuery(rest: string): string | undefined {
  let q = rest
    .replace(/\b(two|three|four|all|both|those|these|every)\b/gi, " ")
    .replace(/\b(which|is|are|there|here|that|this)\b/gi, " ")
    .replace(/\b(the|a|an|my|please|on|for|from|to)\b/gi, " ")
    .replace(/\b(meetings?|events?|calls?|invites?|calendar|appointment|appointments)\b/gi, " ")
    .replace(/\b(with|named|called|titled|about|regarding|named)\b/gi, " ")
    .replace(/["']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (q.length < 2) return undefined;
  return q;
}

export function isQuickDeleteIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(please\s+)?(delete|remove|cancel|drop)\b/i.test(trimmed)) return true;
  return /\b(delete|remove|cancel)\s+(the\s+)?(meeting|meetings|event|events|call|calls|invite|invites)\b/i.test(
    trimmed,
  );
}

export function parseQuickDeleteText(text: string, refDate = new Date()): ParsedQuickDelete {
  let remaining = text.trim();

  remaining = remaining
    .replace(/^(please\s+)?(delete|remove|cancel|drop)\s+/i, "")
    .replace(/^(the\s+)?(meeting|meetings|event|events|call|calls|invite|invites)\s+/i, "")
    .trim();

  const parsedDate = parseDate(remaining, refDate);
  if (parsedDate) remaining = parsedDate.rest;

  const query = extractDeleteQuery(remaining);
  const deleteAllOnDate =
    Boolean(parsedDate?.date) &&
    !query &&
    /\b(meetings|events|calls|both|all|those|these|two|three|four|every)\b/i.test(text);

  return {
    intent: "delete",
    query,
    onDate: parsedDate?.date,
    deleteAllOnDate,
  };
}

export function demoEventMatchesDelete(
  summary: string,
  start: string,
  parsed: ParsedQuickDelete,
): boolean {
  const dayFromStart = start.slice(0, 10);
  if (parsed.onDate) {
    const target = `${parsed.onDate.getFullYear()}-${String(parsed.onDate.getMonth() + 1).padStart(2, "0")}-${String(parsed.onDate.getDate()).padStart(2, "0")}`;
    if (!dayFromStart.startsWith(target)) return false;
  }
  if (parsed.deleteAllOnDate) return true;
  if (parsed.query) return summary.toLowerCase().includes(parsed.query.toLowerCase());
  return Boolean(parsed.onDate);
}
