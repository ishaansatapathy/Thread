/**
 * Thin client for OpenAI's Responses API (POST /v1/responses), shared by
 * one-shot features (openai.ts) and the agent tool loop (openai-tools.ts).
 *
 * Current models (gpt-6-*) only support tool calling here, not on Chat
 * Completions. Requests are stateless (`store: false`): user mail never sits
 * in OpenAI's response store, and reasoning is carried between tool rounds as
 * encrypted reasoning items instead of server-side state.
 */
import { logger } from "@repo/logger";

import { ServiceError } from "../errors";
import { clampEffort, getModelSpec, type ReasoningEffort } from "./model-catalog";
import { fetchOpenAi } from "./openai-fetch";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export type ResponsesTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

export type ResponsesFunctionCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
};

export type ResponsesReasoningItem = { type: "reasoning"; id: string; [key: string]: unknown };

export type ResponsesInputItem =
  | { role: "system" | "developer" | "user" | "assistant"; content: string }
  | ResponsesFunctionCall
  | { type: "function_call_output"; call_id: string; output: string }
  | ResponsesReasoningItem;

export type ResponsesOutputItem =
  | { type: "message"; role?: string; content?: Array<{ type: string; text?: string }> }
  | ResponsesFunctionCall
  | ResponsesReasoningItem
  | { type: string; [key: string]: unknown };

export type ResponsesRequest = {
  model: string;
  input: ResponsesInputItem[];
  effort?: ReasoningEffort;
  /** Ignored for reasoning models, which reject sampling parameters. */
  temperature?: number;
  json?: boolean;
  tools?: ResponsesTool[];
  maxOutputTokens: number;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  label: string;
};

export type ResponsesResult = {
  output: ResponsesOutputItem[];
  text: string;
  functionCalls: ResponsesFunctionCall[];
};

type RawResponse = {
  status?: string;
  output?: ResponsesOutputItem[];
  error?: { message?: string; code?: string } | null;
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
};

export function buildResponsesBody(req: ResponsesRequest): Record<string, unknown> {
  const spec = getModelSpec(req.model);
  const effort = req.effort ? clampEffort(req.model, req.effort) : undefined;
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.input,
    store: false,
    max_output_tokens: req.maxOutputTokens,
  };
  if (effort) {
    body.reasoning = { effort };
    body.include = ["reasoning.encrypted_content"];
  }
  if (spec.temperature && req.temperature !== undefined) body.temperature = req.temperature;
  if (req.json) body.text = { format: { type: "json_object" } };
  if (req.tools?.length) {
    body.tools = req.tools;
    body.parallel_tool_calls = true;
  }
  if (req.onTextDelta) body.stream = true;
  return body;
}

export function outputText(output: ResponsesOutputItem[]): string {
  let text = "";
  for (const item of output) {
    if (item.type !== "message") continue;
    const content = (item as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    for (const part of content) {
      if (part.type === "output_text" && part.text) text += part.text;
    }
  }
  return text.trim();
}

function functionCallsOf(output: ResponsesOutputItem[]): ResponsesFunctionCall[] {
  return output.filter((item): item is ResponsesFunctionCall => item.type === "function_call");
}

function incompleteMessage(reason?: string) {
  if (reason === "max_output_tokens") return "The AI response was too long and got cut off. Try a narrower request.";
  if (reason === "content_filter") return "The AI declined to answer this request.";
  return "The AI response was incomplete. Try again.";
}

function assertUsable(raw: RawResponse) {
  if (raw.status === "failed" || raw.error) {
    throw new ServiceError("INTERNAL", raw.error?.message?.trim() || "OpenAI request failed. Try again shortly.");
  }
  if (raw.status === "incomplete") {
    throw new ServiceError("INTERNAL", incompleteMessage(raw.incomplete_details?.reason));
  }
}

function logUsage(req: ResponsesRequest, raw: RawResponse) {
  const usage = raw.usage;
  if (!usage) return;
  logger.info("openai.usage", {
    label: req.label,
    model: req.model,
    inputTokens: usage.input_tokens,
    cachedTokens: usage.input_tokens_details?.cached_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
  });
}

async function readStream(response: Response, req: ResponsesRequest): Promise<RawResponse> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const items: ResponsesOutputItem[] = [];
  const state: { final: RawResponse | null } = { final: null };
  let buffer = "";

  const handle = (event: Record<string, unknown>) => {
    switch (event.type) {
      case "response.output_text.delta":
        if (typeof event.delta === "string") req.onTextDelta?.(event.delta);
        break;
      case "response.output_item.done":
        if (event.item) items.push(event.item as ResponsesOutputItem);
        break;
      case "response.completed":
      case "response.incomplete":
      case "response.failed":
        state.final = (event.response as RawResponse) ?? {};
        break;
      case "error":
        throw new ServiceError(
          "INTERNAL",
          (typeof event.message === "string" && event.message.trim()) || "OpenAI stream failed. Try again shortly.",
        );
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      handle(event);
    }
  }

  const raw: RawResponse = state.final ?? { status: "completed" };
  if (!raw.output?.length) raw.output = items;
  return raw;
}

export async function createResponse(req: ResponsesRequest): Promise<ResponsesResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");

  const response = await fetchOpenAi(
    RESPONSES_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildResponsesBody(req)),
      signal: req.signal,
    },
    { label: req.label },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    logger.warn("openai.request_failed", { label: req.label, model: req.model, status: response.status });
    throw new ServiceError("INTERNAL", payload.error?.message?.trim() || "OpenAI request failed. Try again shortly.");
  }

  const raw =
    req.onTextDelta && response.body ? await readStream(response, req) : ((await response.json()) as RawResponse);
  assertUsable(raw);
  logUsage(req, raw);

  const output = raw.output ?? [];
  return { output, text: outputText(output), functionCalls: functionCallsOf(output) };
}
