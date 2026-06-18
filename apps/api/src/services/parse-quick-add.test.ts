import { describe, expect, it } from "vitest";

import { parseQuickAddText } from "./parse-quick-add";

const ref = new Date("2026-06-18T10:00:00+05:30");

describe("parseQuickAddText", () => {
  it("parses meeting with time range and compact date", () => {
    const parsed = parseQuickAddText("create meeting from 5pm -6pm on 22june", ref);
    expect(parsed.allDay).toBe(false);
    expect(parsed.summary).toBe("Meeting");
    expect(parsed.startDateTime).toBe("2026-06-22T17:00:00");
    expect(parsed.endDateTime).toBe("2026-06-22T18:00:00");
    expect(parsed.timeZone).toBe("Asia/Kolkata");
  });

  it("parses all-day event with for-title on day number", () => {
    const parsed = parseQuickAddText("add an event on 21 for kolkaat-berhampur tra", ref);
    expect(parsed.allDay).toBe(true);
    expect(parsed.summary).toBe("kolkaat-berhampur tra");
    expect(parsed.startDateTime).toBe("2026-06-21");
    expect(parsed.endDateTime).toBe("2026-06-22");
  });

  it("parses lunch tomorrow at noon", () => {
    const parsed = parseQuickAddText("Lunch with Sarah tomorrow at noon", ref);
    expect(parsed.allDay).toBe(false);
    expect(parsed.summary).toMatch(/Lunch with Sarah/i);
    expect(parsed.startDateTime).toBe("2026-06-19T12:00:00");
  });

  it("parses june 22 with spaced month", () => {
    const parsed = parseQuickAddText("Team sync on 22 june at 3pm", ref);
    expect(parsed.summary).toMatch(/Team sync/i);
    expect(parsed.startDateTime).toBe("2026-06-22T15:00:00");
  });
});
