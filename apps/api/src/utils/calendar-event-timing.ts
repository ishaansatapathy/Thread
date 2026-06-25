const DEFAULT_TZ =
  process.env.THREAD_DEFAULT_TIMEZONE?.trim() ||
  process.env.TZ?.trim() ||
  "Asia/Kolkata";

function normalizeWallDateTime(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const withoutOffset = trimmed.replace(/([+-]\d{2}:\d{2}|Z)$/i, "");
  if (withoutOffset.length === 16) return `${withoutOffset}:00`;
  return withoutOffset.slice(0, 19);
}

export function resolveGoogleCalendarTiming(input: {
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  allDay?: boolean;
}) {
  const timeZone = input.timeZone?.trim() || DEFAULT_TZ;
  const hasTime = input.startDateTime.includes("T") || /\d:\d/.test(input.startDateTime);
  let allDay = input.allDay ?? !hasTime;
  if (hasTime) allDay = false;

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

  let startDateTime = normalizeWallDateTime(input.startDateTime);
  let endDateTime = normalizeWallDateTime(input.endDateTime);

  if (Date.parse(endDateTime) <= Date.parse(startDateTime)) {
    const match = startDateTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (match) {
      let hour = Number.parseInt(match[2]!, 10) + 1;
      const minute = match[3]!;
      if (hour > 23) hour = 23;
      endDateTime = `${match[1]}T${String(hour).padStart(2, "0")}:${minute}:00`;
    }
  }

  return { allDay: false as const, startDateTime, endDateTime, timeZone };
}

/** Google expects wall time + separate timeZone — not offset + timeZone together. */
export function buildGoogleCalendarStartEnd(timing: ReturnType<typeof resolveGoogleCalendarTiming>) {
  if (timing.allDay) {
    return {
      start: { date: timing.startDateTime },
      end: { date: timing.endDateTime },
    };
  }

  return {
    start: { dateTime: timing.startDateTime, timeZone: timing.timeZone },
    end: { dateTime: timing.endDateTime, timeZone: timing.timeZone },
  };
}

export function extractCalendarApiError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const enriched = error as Error & {
    response?: { data?: { error?: { message?: string; errors?: Array<{ message?: string; reason?: string }> } } };
    cause?: unknown;
  };

  const nested = enriched.response?.data?.error;
  if (nested?.message) {
    const reason = nested.errors?.[0]?.reason;
    return reason ? `${nested.message} (${reason})` : nested.message;
  }

  if (enriched.cause instanceof Error && enriched.cause.message !== error.message) {
    return enriched.cause.message;
  }

  return error.message;
}
