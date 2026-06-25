const DEFAULT_TZ =
  process.env.THREAD_DEFAULT_TIMEZONE?.trim() ||
  process.env.TZ?.trim() ||
  "Asia/Kolkata";

const FIXED_OFFSETS: Record<string, string> = {
  "Asia/Kolkata": "+05:30",
  "Asia/Calcutta": "+05:30",
  UTC: "Z",
  "Etc/UTC": "Z",
};

/** Convert wall-clock ISO (no offset) to RFC3339 for Google Calendar. */
export function toGoogleCalendarDateTime(naiveIso: string, timeZone: string): string {
  if (/[+-]\d{2}:\d{2}$/.test(naiveIso) || naiveIso.endsWith("Z")) return naiveIso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(naiveIso)) return naiveIso;

  const base = naiveIso.length === 16 ? `${naiveIso}:00` : naiveIso;
  const offset = FIXED_OFFSETS[timeZone] ?? "+00:00";
  return offset === "Z" ? `${base}Z` : `${base}${offset}`;
}

export function resolveGoogleCalendarTiming(input: {
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  allDay?: boolean;
}) {
  const timeZone = input.timeZone?.trim() || DEFAULT_TZ;
  const allDay =
    input.allDay ?? (!input.startDateTime.includes("T") && !/\d:\d/.test(input.startDateTime));

  if (allDay) {
    const startDate = input.startDateTime.slice(0, 10);
    let endDate = input.endDateTime.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Date.parse(endDate) <= Date.parse(startDate)) {
      const d = new Date(`${startDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      endDate = d.toISOString().slice(0, 10);
    }
    return { allDay: true as const, startDateTime: startDate, endDateTime: endDate, timeZone };
  }

  const startDateTime = toGoogleCalendarDateTime(input.startDateTime, timeZone);
  let endDateTime = toGoogleCalendarDateTime(input.endDateTime, timeZone);

  if (Date.parse(endDateTime) <= Date.parse(startDateTime)) {
    const match = input.startDateTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (match) {
      let hour = Number.parseInt(match[2]!, 10) + 1;
      const minute = match[3]!;
      if (hour > 23) hour = 23;
      endDateTime = toGoogleCalendarDateTime(`${match[1]}T${String(hour).padStart(2, "0")}:${minute}:00`, timeZone);
    }
  }

  return { allDay: false as const, startDateTime, endDateTime, timeZone };
}
