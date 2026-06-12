import { describe, expect, it } from "vitest";

import { mapWithConcurrency, parseHeaderDate } from "./inbox";

describe("mapWithConcurrency", () => {
  it("preserves input order in the output", async () => {
    const input = [10, 20, 30, 40, 50];
    const result = await mapWithConcurrency(input, 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value % 30));
      return value * 2;
    });
    expect(result).toEqual([20, 40, 60, 80, 100]);
  });

  it("never exceeds the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty list", async () => {
    const result = await mapWithConcurrency([], 4, async (value) => value);
    expect(result).toEqual([]);
  });
});

describe("parseHeaderDate", () => {
  it("parses an RFC-2822 Date header", () => {
    const parsed = parseHeaderDate("Wed, 10 Jun 2026 09:30:00 -0700");
    expect(parsed?.toISOString()).toBe("2026-06-10T16:30:00.000Z");
  });

  it("returns undefined for missing or invalid input", () => {
    expect(parseHeaderDate(undefined)).toBeUndefined();
    expect(parseHeaderDate("not a date")).toBeUndefined();
  });
});
