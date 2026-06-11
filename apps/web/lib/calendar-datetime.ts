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
  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) return start.slice(0, 10);
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
