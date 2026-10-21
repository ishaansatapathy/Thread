import { logger } from "@repo/logger";

import { ServiceError } from "../errors";

import type { ReasoningEffort } from "./model-catalog";
import { getOpenAiModel, isOpenAiConfigured } from "./openai-config";
import {
  createResponse,
  type ResponsesInputItem,
  type ResponsesOutputItem,
  type ResponsesTool,
} from "./openai-responses";

const DEFAULT_TIMEOUT_MS = 60_000;
/** Hard ceiling on tool-call rounds. Must match the maxRounds passed by runAgentChat. */
const MAX_TOOL_ROUNDS = 6;
/** Per-round output budget; reasoning tokens count against it. */
const MAX_OUTPUT_TOKENS = 16_000;
/** Tool results beyond this are truncated so one big search can't flood the context window. */
const MAX_TOOL_RESULT_CHARS = 24_000;

/** Tool definitions keep the familiar nested shape; they are flattened for the Responses API. */
export type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type OpenAiConversationMessage = { role: "system" | "user" | "assistant"; content: string };

export type ToolLoopEscalation = {
  model: string;
  effort?: ReasoningEffort;
  afterRounds: number;
  afterToolErrors: number;
  onEscalate?: (reason: string) => void;
};

function toResponsesTools(tools: OpenAiToolDefinition[]): ResponsesTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }));
}

function isToolError(result: string): boolean {
  try {
    const parsed = JSON.parse(result) as { error?: unknown; success?: unknown };
    return Boolean(parsed && (parsed.error || parsed.success === false));
  } catch {
    return false;
  }
}

function capToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  return `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated: result was ${result.length} characters; narrow the query for more]`;
}

/**
 * Converts this round's output into input items for the next round. Reasoning
 * items carry the model's encrypted chain of thought between tool calls and
 * must be replayed to the same model; server-side item ids are dropped because
 * requests are stateless.
 */
function carryForward(output: ResponsesOutputItem[]): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  for (const item of output) {
    if (item.type === "reasoning") {
      items.push(item as ResponsesInputItem);
    } else if (item.type === "function_call") {
      const call = item as { call_id: string; name: string; arguments: string };
      items.push({ type: "function_call", call_id: call.call_id, name: call.name, arguments: call.arguments });
    } else if (item.type === "message") {
      const content = (item as { content?: Array<{ type: string; text?: string }> }).content ?? [];
      const text = content.map((part) => (part.type === "output_text" ? (part.text ?? "") : "")).join("");
      if (text) items.push({ role: "assistant", content: text });
    }
  }
  return items;
}

export async function runOpenAiToolLoop(
  messages: OpenAiConversationMessage[],
  tools: OpenAiToolDefinition[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts?: {
    maxRounds?: number;
    timeoutMs?: number;
    onToken?: (delta: string) => void;
    signal?: AbortSignal;
    model?: string;
    effort?: ReasoningEffort;
    /** Switch the rest of the loop to a stronger model once the current one struggles. */
    escalation?: ToolLoopEscalation;
  },
): Promise<{ content: string }> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  const maxRounds = opts?.maxRounds ?? MAX_TOOL_ROUNDS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const responsesTools = toResponsesTools(tools);
  const escalation = opts?.escalation;
  let model = opts?.model ?? getOpenAiModel();
  let effort = opts?.effort;
  let toolErrors = 0;
  let input: ResponsesInputItem[] = messages.map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < maxRounds; round += 1) {
    if (opts?.signal?.aborted) {
      throw new ServiceError("INTERNAL", "Agent request cancelled.");
    }

    if (escalation && model !== escalation.model) {
      const reason =
        toolErrors >= escalation.afterToolErrors ? "tool_errors" : round >= escalation.afterRounds ? "many_rounds" : null;
      if (reason) {
        model = escalation.model;
        effort = escalation.effort ?? effort;
        // Encrypted reasoning is only valid for the model that produced it.
        input = input.filter((item) => !("type" in item && item.type === "reasoning"));
        escalation.onEscalate?.(reason);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    opts?.signal?.addEventListener("abort", onExternalAbort);

    let result: Awaited<ReturnType<typeof createResponse>>;
    try {
      result = await createResponse({
        model,
        effort,
        input,
        tools: responsesTools,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        signal: controller.signal,
        onTextDelta: opts?.onToken,
        label: opts?.onToken ? "agent.stream" : "agent",
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (opts?.signal?.aborted) {
        throw new ServiceError("INTERNAL", "Agent request cancelled.");
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ServiceError("INTERNAL", "OpenAI request timed out.");
      }
      throw new ServiceError("INTERNAL", "OpenAI request failed. Try again shortly.");
    } finally {
      clearTimeout(timeout);
      opts?.signal?.removeEventListener("abort", onExternalAbort);
    }

    if (result.functionCalls.length === 0) {
      if (!result.text) throw new ServiceError("INTERNAL", "OpenAI returned an empty response.");
      return { content: result.text };
    }

    input = [...input, ...carryForward(result.output)];

    for (const call of result.functionCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      let output: string;
      try {
        output = await executeTool(call.name, args);
      } catch (error) {
        output = JSON.stringify({ error: error instanceof Error ? error.message : "Tool execution failed" });
      }
      if (isToolError(output)) toolErrors += 1;

      input.push({ type: "function_call_output", call_id: call.call_id, output: capToolResult(output) });
    }
  }

  logger.warn("agent.tool_rounds_exhausted", { model, maxRounds });
  throw new ServiceError(
    "INTERNAL",
    "I ran out of steps before completing your request. Try breaking it into smaller tasks.",
  );
}
