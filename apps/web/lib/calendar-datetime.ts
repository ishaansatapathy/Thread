/** Local calendar day key — never use toISOString().slice(0, 10) for UI buckets. */
export function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function eventDayKey(start?: string) {
  if (!start) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;

  const datePrefix = start.match(/^(\d{4}-\d{2}-\d{2})/);
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(start) || start.endsWith("Z");

  // Naive datetimes (no offset) — use the date the user picked, not UTC conversion.
  if (datePrefix && !hasOffset) {
    return datePrefix[1];
  }

  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) {
    return datePrefix?.[1] ?? start.slice(0, 10);
  }
  return localDayKey(parsed);
}

export function toLocalDateTimeInput(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function localDateTimeInputToPayload(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date/time");
  }

  return {
    startDateTime: value.length === 16 ? `${value}:00` : value,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

export function validateLocalDateTimeRange(startValue: string, endValue: string) {
  if (!startValue.trim() || !endValue.trim()) {
    return { valid: false as const, message: "Start and end date/time are required." };
  }

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { valid: false as const, message: "Invalid date/time — please review your dates." };
  }

  if (end.getTime() <= start.getTime()) {
    return {
      valid: false as const,
      message: "End must be after start — please review your dates.",
    };
  }

  return { valid: true as const };
}

export function localDateTimeRangeToPayload(startValue: string, endValue: string) {
  const check = validateLocalDateTimeRange(startValue, endValue);
  if (!check.valid) {
    throw new Error(check.message);
  }

  const start = localDateTimeInputToPayload(startValue);
  const end = localDateTimeInputToPayload(endValue);
  return {
    startDateTime: start.startDateTime,
    endDateTime: end.startDateTime,
    timeZone: start.timeZone,
  };
}

export function isoToLocalDateTimeInput(value?: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T09:00`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return toLocalDateTimeInput(parsed);
}

export function eventToArchivePayload(
  event: {
    id: string;
    summary: string;
    start?: string;
    end?: string;
    htmlLink?: string;
    recurringEventId?: string;
  },
  opts?: { editScope?: "instance" | "series" | "following" },
) {
  const startInput = isoToLocalDateTimeInput(event.start);
  const endInput = isoToLocalDateTimeInput(event.end) || startInput;
  const start = localDateTimeInputToPayload(startInput || toLocalDateTimeInput(new Date()));
  const end = endInput
    ? localDateTimeInputToPayload(endInput)
    : { startDateTime: start.startDateTime, timeZone: start.timeZone };

  return {
    eventId: event.id,
    summary: event.summary,
    startDateTime: start.startDateTime,
    endDateTime: end.startDateTime,
    timeZone: start.timeZone,
    htmlLink: event.htmlLink,
    recurringEventId: event.recurringEventId,
    editScope: opts?.editScope ?? "instance",
  };
}

export function eventToDeletePayload(
  event: { id: string; summary: string; htmlLink?: string; recurringEventId?: string },
  opts?: { editScope?: "instance" | "series" | "following" },
) {
  return {
    eventId: event.id,
    summary: event.summary,
    htmlLink: event.htmlLink,
    recurringEventId: event.recurringEventId,
    editScope: opts?.editScope ?? "instance",
  };
}
