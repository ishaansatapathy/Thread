import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyAgentRequest, planAgentModel, resolveAgentModel, resolveTaskModel } from "./model-router";

const tier = (message: string, extra: Partial<Parameters<typeof classifyAgentRequest>[0]> = {}) =>
  classifyAgentRequest({ message, historyTokens: 0, toolMemoryCount: 0, ...extra }).tier;

describe("classifyAgentRequest — stays fast for everyday actions", () => {
  it.each([
    "What's on my calendar today?",
    "Summarize this email",
    "Reply to Priya saying Thursday works",
    "Send an email to rahul@acme.com saying I'll be 10 minutes late",
    "Archive all newsletters from last month",
    "Schedule a meeting with ana@acme.com tomorrow at 3pm",
    "Create a Google Meet link",
    "Save this attachment to Drive",
    "Mark everything from LinkedIn as read",
    "Draft a reply thanking them",
    "kal ki meetings dikhao",
  ])("%s", (message) => {
    expect(tier(message)).toBe("fast");
  });
});

describe("classifyAgentRequest — escalates when it matters", () => {
  it.each([
    ["Priya's email asks to meet Thursday, set up a gmeet and reply to confirm", "multi_intent"],
    ["Save the attachments to Drive and then email the link to Rahul", "chained"],
    ["Make a spreadsheet of my receipts from this month's emails", "extract_into_file"],
    ["Write meeting notes from yesterday's transcript", "transcript_extraction"],
    ["Draft a reply to the investor about the term sheet", "high_stakes_writing"],
    ["Write an apology to the client for the delay", "high_stakes_writing"],
    ["Analyze my inbox and tell me what I'm neglecting", "analysis"],
    ["Summarize all my emails from last month", "bulk_scope"],
    ["Find a time when ana@acme.com and raj@acme.com are both free", "schedule_from_thread"],
    ["Schedule a sync with everyone on the team next week", "group_coordination"],
    ["No, that's wrong, I meant next Friday", "user_correction"],
    ["galat time daala, phir se karo", "user_correction"],
  ])("%s", (message, reason) => {
    const result = classifyAgentRequest({ message, historyTokens: 0, toolMemoryCount: 0 });
    expect(result.tier).toBe("smart");
    expect(result.reason).toContain(reason);
  });

  it("escalates scheduling from a focused email thread", () => {
    expect(tier("Book this meeting", { hasThreadFocus: true })).toBe("smart");
    expect(tier("Book this meeting", { hasThreadFocus: false })).toBe("fast");
  });

  it("escalates long messages, long history and deep tool memory", () => {
    expect(tier("a ".repeat(400))).toBe("smart");
    expect(tier("continue", { historyTokens: 5_000 })).toBe("smart");
    expect(tier("go on", { toolMemoryCount: 12 })).toBe("smart");
  });
});

describe("model resolution", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_SMART;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const simple = { message: "hi", historyTokens: 0, toolMemoryCount: 0 };
  const hard = { message: "Draft a reply to the investor", historyTokens: 0, toolMemoryCount: 0 };

  it("uses Luna for everyday agent work and Sol for hard requests by default", () => {
    expect(resolveAgentModel(simple)).toMatchObject({ tier: "fast", model: "gpt-6-luna", effort: "low" });
    expect(resolveAgentModel(hard)).toMatchObject({ tier: "smart", model: "gpt-6.1-sol", effort: "medium" });
  });

  it("respects env overrides", () => {
    process.env.OPENAI_MODEL = "gpt-6-sol";
    process.env.OPENAI_MODEL_SMART = "gpt-6-astra";
    expect(resolveAgentModel(simple).model).toBe("gpt-6-sol");
    expect(resolveAgentModel(hard).model).toBe("gpt-6-astra");
  });

  it("keeps everything on the fast tier when OPENAI_MODEL_SMART=off", () => {
    process.env.OPENAI_MODEL_SMART = "off";
    const decision = resolveAgentModel(hard);
    expect(decision).toMatchObject({ tier: "fast", model: "gpt-6-luna" });
    expect(decision.reason).toContain("smart_tier_off");
  });

  it("keeps one-shot features fast with minimal effort unless the input is huge", () => {
    expect(resolveTaskModel("summarize_thread", 5_000)).toMatchObject({ model: "gpt-6-luna", effort: "none" });
    expect(resolveTaskModel("smart_reply", 2_000)).toMatchObject({ model: "gpt-6-luna", effort: "none" });
    expect(resolveTaskModel("daily_brief", 10_000)).toMatchObject({ model: "gpt-6-luna", effort: "low" });
    expect(resolveTaskModel("daily_brief", 50_000)).toMatchObject({ model: "gpt-6.1-sol", effort: "low" });
    expect(resolveTaskModel("inbox_priority", 500_000).model).toBe("gpt-6-luna");
  });

  it("only offers mid-run escalation when the run starts on the fast tier", () => {
    expect(planAgentModel("t1", simple).escalation).toMatchObject({ model: "gpt-6.1-sol", effort: "medium" });
    expect(planAgentModel("t1", hard).escalation).toBeUndefined();

    process.env.OPENAI_MODEL_SMART = "off";
    expect(planAgentModel("t1", simple).escalation).toBeUndefined();
  });
});
