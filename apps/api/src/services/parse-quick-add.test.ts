import { describe, expect, it } from "vitest";

import { parseQuickAddText } from "./parse-quick-add";

const ref = new Date("2026-06-18T10:00:00+05:30");

describe("parseQuickAddText", () => {
  it("queues all-day events with time noted in the title", () => {
    const parsed = parseQuickAddText("create meeting from 5pm -6pm on 22june", ref);
    expect(parsed.allDay).toBe(true);
    expect(parsed.summary).toBe("Meeting (5pm-6pm)");
    expect(parsed.startDateTime).toBe("2026-06-22");
    expect(parsed.endDateTime).toBe("2026-06-23");
    expect(parsed.timeZone).toBe("Asia/Kolkata");
  });

  it("parses all-day event with for-title on day number", () => {
    const parsed = parseQuickAddText("add an event on 21 for kolkaat-berhampur tra", ref);
    expect(parsed.allDay).toBe(true);
    expect(parsed.summary).toBe("Kolkaat-berhampur tra");
    expect(parsed.startDateTime).toBe("2026-06-21");
    expect(parsed.endDateTime).toBe("2026-06-22");
  });

  it("keeps lunch tomorrow as all-day with time in title", () => {
    const parsed = parseQuickAddText("Lunch with Sarah tomorrow at noon", ref);
    expect(parsed.allDay).toBe(true);
    expect(parsed.summary).toMatch(/Lunch with Sarah/i);
    expect(parsed.startDateTime).toBe("2026-06-19");
    expect(parsed.endDateTime).toBe("2026-06-20");
  });

  it("queues team sync on june 22 as all-day", () => {
    const parsed = parseQuickAddText("Team sync on 22 june at 3pm", ref);
    expect(parsed.allDay).toBe(true);
    expect(parsed.summary).toMatch(/Team sync/i);
    expect(parsed.startDateTime).toBe("2026-06-22");
  });

  it("parses for-title before time range without swallowing times", () => {
    const parsed = parseQuickAddText(
      "add event on 27 for corsair hackathon discussion from 8pm-10pm",
      ref,
    );
    expect(parsed.allDay).toBe(true);
    expect(parsed.summary).toBe("Corsair hackathon discussion (8pm-10pm)");
    expect(parsed.startDateTime).toBe("2026-06-27");
    expect(parsed.endDateTime).toBe("2026-06-28");
  });

  it("parses set prefix with from-to range on day number", () => {
    const parsed = parseQuickAddText("set corsair hackathon discussion from 8pm-10pm on 27", ref);
    expect(parsed.allDay).toBe(true);
    expect(parsed.summary).toMatch(/corsair hackathon discussion \(8pm-10pm\)/i);
    expect(parsed.startDateTime).toBe("2026-06-27");
  });

  it("parses meeting with spaced times on june day", () => {
    const parsed = parseQuickAddText("add a meeting from 8 pm -10pm on 28 june", ref);
    expect(parsed.allDay).toBe(true);
    expect(parsed.startDateTime).toBe("2026-06-28");
    expect(parsed.endDateTime).toBe("2026-06-29");
    expect(parsed.summary).toBe("Meeting (8pm-10pm)");
  });
});
