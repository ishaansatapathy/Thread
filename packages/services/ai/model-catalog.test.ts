import { afterEach, describe, expect, it } from "vitest";

import { clampEffort, DEFAULT_MODELS, resolveTierModel } from "./model-catalog";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveTierModel", () => {
  it("defaults to the current fast and smart models", () => {
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_SMART;
    expect(resolveTierModel("fast")).toBe(DEFAULT_MODELS.fast);
    expect(resolveTierModel("smart")).toBe(DEFAULT_MODELS.smart);
  });

  it("keeps a deprecated model until its shutdown date", () => {
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    expect(resolveTierModel("fast", new Date("2026-12-01T00:00:00Z"))).toBe("gpt-4o-mini");
  });

  it("falls back to the tier default once the model is shut down", () => {
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    process.env.OPENAI_MODEL_SMART = "gpt-4o";
    const after = new Date("2027-01-15T00:00:00Z");
    expect(resolveTierModel("fast", after)).toBe(DEFAULT_MODELS.fast);
    expect(resolveTierModel("smart", after)).toBe(DEFAULT_MODELS.smart);
  });

  it("passes through models it does not know about", () => {
    process.env.OPENAI_MODEL_SMART = "gpt-6-astra";
    expect(resolveTierModel("smart")).toBe("gpt-6-astra");
  });
});

describe("clampEffort", () => {
  it("keeps supported efforts", () => {
    expect(clampEffort("gpt-6-luna", "none")).toBe("none");
    expect(clampEffort("gpt-6.1-sol", "medium")).toBe("medium");
  });

  it("rounds up to the nearest supported effort", () => {
    expect(clampEffort("gpt-6.1-sol", "none")).toBe("low");
    expect(clampEffort("gpt-6-astra", "minimal")).toBe("low");
  });

  it("returns undefined for non-reasoning models", () => {
    expect(clampEffort("gpt-4o-mini", "low")).toBeUndefined();
    expect(clampEffort("gpt-4.1", "low")).toBeUndefined();
  });
});
