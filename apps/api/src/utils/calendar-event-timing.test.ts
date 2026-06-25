import { describe, expect, it } from "vitest";

import {
  buildGoogleCalendarStartEnd,
  resolveGoogleCalendarTiming,
} from "./calendar-event-timing";

describe("calendar-event-timing", () => {
  it("builds wall time + timeZone for Google (no offset in dateTime)", () => {
    const timing = resolveGoogleCalendarTiming({
      startDateTime: "2026-06-28T20:00:00",
      endDateTime: "2026-06-28T22:00:00",
      timeZone: "Asia/Kolkata",
      allDay: false,
    });
    const { start, end } = buildGoogleCalendarStartEnd(timing);
    expect(start).toEqual({ dateTime: "2026-06-28T20:00:00", timeZone: "Asia/Kolkata" });
    expect(end).toEqual({ dateTime: "2026-06-28T22:00:00", timeZone: "Asia/Kolkata" });
  });

  it("forces timed events when start contains a clock time", () => {
    const timing = resolveGoogleCalendarTiming({
      startDateTime: "2026-06-28T20:00:00",
      endDateTime: "2026-06-28T22:00:00",
      timeZone: "Asia/Kolkata",
      allDay: true,
    });
    expect(timing.allDay).toBe(false);
  });

  it("keeps all-day end exclusive", () => {
    const timing = resolveGoogleCalendarTiming({
      startDateTime: "2026-06-28",
      endDateTime: "2026-06-28",
      allDay: true,
    });
    expect(timing.endDateTime).toBe("2026-06-29");
  });
});
