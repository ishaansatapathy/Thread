import { describe, expect, it } from "vitest";

import { fetchInWaves } from "./gmail-batch";

describe("fetchInWaves", () => {
  it("preserves order across waves", async () => {
    const input = [1, 2, 3, 4, 5];
    const result = await fetchInWaves(input, 2, async (value) => value * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it("handles an empty list", async () => {
    const result = await fetchInWaves([], 3, async (value) => value);
    expect(result).toEqual([]);
  });
});
