import { beforeEach, describe, expect, it, vi } from "vitest";

type Body = { model: string; input: Array<Record<string, unknown>>; reasoning?: { effort: string } };
const requests: Body[] = [];
let replies: Array<Record<string, unknown>[]> = [];

vi.mock("./openai-fetch", () => ({
  fetchOpenAi: vi.fn(async (_url: string, init: { body: string }) => {
    requests.push(JSON.parse(init.body) as Body);
    const output = replies.shift() ?? [message("done")];
    return new Response(JSON.stringify({ status: "completed", output }), { status: 200 });
  }),
}));

import { runOpenAiToolLoop } from "./openai-tools";

function message(text: string) {
  return { type: "message", role: "assistant", content: [{ type: "output_text", text }] };
}

function callRound(id: string) {
  return [
    { type: "reasoning", id: `rs_${id}`, encrypted_content: "enc" },
    { type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name: "search_inbox", arguments: "{}" },
  ];
}

const escalation = { model: "gpt-6.1-sol", effort: "medium" as const, afterRounds: 3, afterToolErrors: 2 };
const ok = async () => JSON.stringify({ ok: true });

describe("runOpenAiToolLoop (Responses API)", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test";
    requests.length = 0;
    replies = [];
  });

  it("replays reasoning + function calls and returns tool outputs by call_id", async () => {
    replies = [callRound("a"), [message("Found 2 threads.")]];
    const result = await runOpenAiToolLoop([{ role: "user", content: "find invoices" }], [], ok, {
      model: "gpt-6-luna",
      effort: "low",
    });
    expect(result.content).toBe("Found 2 threads.");
    const second = requests[1]!;
    expect(second.reasoning).toEqual({ effort: "low" });
    expect(second.input.map((i) => i.type ?? i.role)).toEqual(["user", "reasoning", "function_call", "function_call_output"]);
    expect(second.input[2]).not.toHaveProperty("id");
    expect(second.input[3]).toMatchObject({ call_id: "call_a", output: '{"ok":true}' });
  });

  it("escalates after repeated tool errors and drops the fast model's reasoning", async () => {
    replies = [callRound("a"), callRound("b"), [message("fixed it")]];
    const onEscalate = vi.fn();
    const result = await runOpenAiToolLoop(
      [{ role: "user", content: "hi" }],
      [],
      async () => JSON.stringify({ success: false, error: "not found" }),
      { model: "gpt-6-luna", effort: "low", escalation: { ...escalation, onEscalate } },
    );
    expect(result.content).toBe("fixed it");
    expect(requests.map((r) => r.model)).toEqual(["gpt-6-luna", "gpt-6-luna", "gpt-6.1-sol"]);
    expect(requests[2]!.reasoning).toEqual({ effort: "medium" });
    expect(requests[2]!.input.some((i) => i.type === "reasoning")).toBe(false);
    expect(onEscalate).toHaveBeenCalledWith("tool_errors");
  });

  it("escalates after too many rounds even without errors", async () => {
    replies = [callRound("a"), callRound("b"), callRound("c"), [message("ok")]];
    await runOpenAiToolLoop([{ role: "user", content: "hi" }], [], ok, { model: "gpt-6-luna", escalation });
    expect(requests.map((r) => r.model)).toEqual(["gpt-6-luna", "gpt-6-luna", "gpt-6-luna", "gpt-6.1-sol"]);
  });

  it("stays on the fast model for quick successful runs", async () => {
    replies = [callRound("a"), [message("ok")]];
    await runOpenAiToolLoop([{ role: "user", content: "hi" }], [], ok, { model: "gpt-6-luna", escalation });
    expect(requests.map((r) => r.model)).toEqual(["gpt-6-luna", "gpt-6-luna"]);
  });

  it("caps huge tool results so they cannot flood the context window", async () => {
    replies = [callRound("a"), [message("ok")]];
    await runOpenAiToolLoop([{ role: "user", content: "hi" }], [], async () => "x".repeat(100_000), {
      model: "gpt-6-luna",
    });
    const output = requests[1]!.input[3]!.output as string;
    expect(output.length).toBeLessThan(25_000);
    expect(output).toContain("[truncated");
  });

  it("gives up cleanly when the round budget runs out", async () => {
    replies = [callRound("a"), callRound("b")];
    await expect(
      runOpenAiToolLoop([{ role: "user", content: "hi" }], [], ok, { model: "gpt-6-luna", maxRounds: 2 }),
    ).rejects.toThrow(/ran out of steps/);
  });
});
