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
    expect(parsed.summary).toBe("Kolkaat-berhampur tra");
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

  it("parses timed event when title uses for before time range", () => {
    const parsed = parseQuickAddText(
      "add event on 27 for corsair hackathon discussion from 8pm-10pm",
      ref,
    );
    expect(parsed.allDay).toBe(false);
    expect(parsed.summary).toBe("Corsair hackathon discussion");
    expect(parsed.startDateTime).toBe("2026-06-27T20:00:00");
    expect(parsed.endDateTime).toBe("2026-06-27T22:00:00");
  });

  it("parses set prefix with from-to range on day number", () => {
    const parsed = parseQuickAddText("set corsair hackathon discussion from 8pm-10pm on 27", ref);
    expect(parsed.allDay).toBe(false);
    expect(parsed.summary).toMatch(/corsair hackathon discussion/i);
    expect(parsed.startDateTime).toBe("2026-06-27T20:00:00");
  });

  it("parses meeting with spaced times on june day", () => {
    const parsed = parseQuickAddText("add a meeting from 8 pm -10pm on 28 june", ref);
    expect(parsed.allDay).toBe(false);
    expect(parsed.startDateTime).toBe("2026-06-28T20:00:00");
    expect(parsed.endDateTime).toBe("2026-06-28T22:00:00");
    expect(parsed.summary).toMatch(/Meeting/i);
  });
});
