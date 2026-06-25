import { describe, expect, it } from "vitest";

import { resolveGoogleCalendarTiming, toGoogleCalendarDateTime } from "./calendar-event-timing";

describe("calendar-event-timing", () => {
  it("adds IST offset for naive wall times", () => {
    expect(toGoogleCalendarDateTime("2026-06-28T20:00:00", "Asia/Kolkata")).toBe(
      "2026-06-28T20:00:00+05:30",
    );
  });

  it("normalizes quick-add meeting payload for Google", () => {
    const timing = resolveGoogleCalendarTiming({
      startDateTime: "2026-06-28T20:00:00",
      endDateTime: "2026-06-28T22:00:00",
      timeZone: "Asia/Kolkata",
      allDay: false,
    });
    expect(timing.allDay).toBe(false);
    expect(timing.startDateTime).toBe("2026-06-28T20:00:00+05:30");
    expect(timing.endDateTime).toBe("2026-06-28T22:00:00+05:30");
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
