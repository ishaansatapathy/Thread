import { logger } from "@repo/logger";

import { ServiceError } from "../errors";

import { resolveTaskModel, type AiTask } from "./model-router";
import { createResponse } from "./openai-responses";

export { getOpenAiModel, getSmartModel, isOpenAiConfigured } from "./openai-config";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 8_000;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** One-shot completion for a named feature; the router picks model and reasoning effort per task. */
export async function createChatCompletion(
  messages: ChatMessage[],
  opts: { task: AiTask; temperature?: number; jsonObject?: boolean },
) {
  const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
  const decision = resolveTaskModel(opts.task, inputChars);
  if (decision.tier === "smart") {
    logger.info("ai.model_escalated", { task: opts.task, reason: decision.reason, inputChars });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const { text } = await createResponse({
      model: decision.model,
      effort: decision.effort,
      input: messages,
      temperature: opts.temperature,
      json: opts.jsonObject,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      signal: controller.signal,
      label: `ai.${opts.task}`,
    });
    if (!text) throw new ServiceError("INTERNAL", "OpenAI returned an empty response.");
    return text;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ServiceError("INTERNAL", "OpenAI request timed out.");
    }
    throw new ServiceError("INTERNAL", "OpenAI request failed. Try again shortly.");
  } finally {
    clearTimeout(timeout);
  }
}
