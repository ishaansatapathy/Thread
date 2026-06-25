import { describe, expect, it } from "vitest";

import { isQuickDeleteIntent, parseQuickDeleteText } from "./parse-quick-delete";

const ref = new Date("2026-06-25T10:00:00+05:30");

describe("isQuickDeleteIntent", () => {
  it("detects delete meeting phrasing", () => {
    expect(isQuickDeleteIntent("Delete meeting with manu on 27 june")).toBe(true);
    expect(isQuickDeleteIntent("add meeting on 28 june")).toBe(false);
  });
});

describe("parseQuickDeleteText", () => {
  it("extracts manu query and date", () => {
    const parsed = parseQuickDeleteText("Delete meeting with manu on 27 june", ref);
    expect(parsed.intent).toBe("delete");
    expect(parsed.query).toBe("manu");
    expect(parsed.onDate?.getDate()).toBe(27);
    expect(parsed.onDate?.getMonth()).toBe(5);
    expect(parsed.deleteAllOnDate).toBe(false);
  });

  it("deletes all events on a day when plural with no title", () => {
    const parsed = parseQuickDeleteText("delete two meetings which is there on 27 june", ref);
    expect(parsed.onDate?.getDate()).toBe(27);
    expect(parsed.deleteAllOnDate).toBe(true);
  });
});
