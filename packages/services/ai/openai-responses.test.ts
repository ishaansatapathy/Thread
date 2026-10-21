import { beforeEach, describe, expect, it, vi } from "vitest";

let nextResponse: () => Response = () => new Response("{}");

vi.mock("./openai-fetch", () => ({
  fetchOpenAi: vi.fn(async () => nextResponse()),
}));

import { buildResponsesBody, createResponse } from "./openai-responses";

const base = { input: [{ role: "user" as const, content: "hi" }], maxOutputTokens: 1000, label: "test" };

function sse(events: Array<Record<string, unknown>>) {
  const text = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("buildResponsesBody", () => {
  it("sends reasoning effort and no temperature to reasoning models", () => {
    const body = buildResponsesBody({ ...base, model: "gpt-6-luna", effort: "none", temperature: 0.5, json: true });
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      store: false,
      reasoning: { effort: "none" },
      text: { format: { type: "json_object" } },
      max_output_tokens: 1000,
    });
    expect(body).not.toHaveProperty("temperature");
  });

  it("clamps effort to what the model accepts (Sol has no 'none')", () => {
    expect(buildResponsesBody({ ...base, model: "gpt-6.1-sol", effort: "none" }).reasoning).toEqual({ effort: "low" });
  });

  it("sends temperature and no reasoning to legacy chat models", () => {
    const body = buildResponsesBody({ ...base, model: "gpt-4o-mini", effort: "low", temperature: 0.3 });
    expect(body).toMatchObject({ temperature: 0.3 });
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("include");
  });
});

describe("createResponse", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test";
  });

  it("joins output_text parts and ignores reasoning items", async () => {
    nextResponse = () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            { type: "reasoning", id: "rs_1" },
            { type: "message", content: [{ type: "output_text", text: "Hello " }, { type: "output_text", text: "there" }] },
          ],
        }),
      );
    const result = await createResponse({ ...base, model: "gpt-6-luna" });
    expect(result.text).toBe("Hello there");
    expect(result.functionCalls).toEqual([]);
  });

  it("turns a truncated response into a clear error", async () => {
    nextResponse = () =>
      new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }));
    await expect(createResponse({ ...base, model: "gpt-6-luna" })).rejects.toThrow(/too long/);
  });

  it("surfaces API errors", async () => {
    nextResponse = () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 });
    await expect(createResponse({ ...base, model: "nope" })).rejects.toThrow("model not found");
  });

  it("streams text deltas and collects tool calls from the completed event", async () => {
    const call = { type: "function_call", call_id: "c1", name: "list_inbox", arguments: "{}" };
    nextResponse = () =>
      sse([
        { type: "response.created", response: {} },
        { type: "response.output_text.delta", delta: "Check" },
        { type: "response.output_text.delta", delta: "ing…" },
        { type: "response.output_item.done", item: call },
        { type: "response.completed", response: { status: "completed", output: [call] } },
      ]);
    const deltas: string[] = [];
    const result = await createResponse({ ...base, model: "gpt-6-luna", onTextDelta: (d) => deltas.push(d) });
    expect(deltas.join("")).toBe("Checking…");
    expect(result.functionCalls).toMatchObject([{ call_id: "c1", name: "list_inbox" }]);
  });

  it("throws on a stream error event", async () => {
    nextResponse = () => sse([{ type: "error", message: "rate limited" }]);
    await expect(createResponse({ ...base, model: "gpt-6-luna", onTextDelta: () => {} })).rejects.toThrow("rate limited");
  });
});
