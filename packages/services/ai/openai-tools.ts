import { ServiceError } from "../errors";

import { getOpenAiModel, isOpenAiConfigured } from "./openai";

const DEFAULT_TIMEOUT_MS = 60_000;
/** Hard ceiling on tool-call rounds. Must match the maxRounds passed by runAgentChat. */
const MAX_TOOL_ROUNDS = 6;

export type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAiConversationMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export async function runOpenAiToolLoop(
  messages: OpenAiConversationMessage[],
  tools: OpenAiToolDefinition[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts?: { maxRounds?: number; timeoutMs?: number },
): Promise<{ content: string; messages: OpenAiConversationMessage[] }> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const maxRounds = opts?.maxRounds ?? MAX_TOOL_ROUNDS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transcript = [...messages];

  for (let round = 0; round < maxRounds; round += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let payload: {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
    };

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getOpenAiModel(),
          messages: transcript,
          tools,
          tool_choice: "auto",
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      payload = (await response.json()) as typeof payload;

      if (!response.ok) {
        throw new ServiceError(
          "INTERNAL",
          payload.error?.message?.trim() || "OpenAI request failed. Try again shortly.",
        );
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ServiceError("INTERNAL", "OpenAI request timed out.");
      }
      throw new ServiceError("INTERNAL", "OpenAI request failed. Try again shortly.");
    } finally {
      clearTimeout(timeout);
    }

    const choice = payload.choices?.[0]?.message;
    if (!choice) {
      throw new ServiceError("INTERNAL", "OpenAI returned an empty response.");
    }

    if (choice.tool_calls?.length) {
      transcript.push({
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: choice.tool_calls,
      });

      for (const call of choice.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }

        let result: string;
        try {
          result = await executeTool(call.function.name, args);
        } catch (error) {
          result = JSON.stringify({
            error: error instanceof Error ? error.message : "Tool execution failed",
          });
        }

        transcript.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }

      continue;
    }

    const content = choice.content?.trim();
    if (!content) {
      throw new ServiceError("INTERNAL", "OpenAI returned an empty response.");
    }

    transcript.push({ role: "assistant", content });
    return { content, messages: transcript };
  }

  throw new ServiceError("INTERNAL", "Agent exceeded the maximum number of tool calls.");
}
