import { resolveTierModel } from "./model-catalog";

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Fast tier model (OPENAI_MODEL, default gpt-6-luna). */
export function getOpenAiModel() {
  return resolveTierModel("fast");
}

/** OPENAI_MODEL_SMART=off keeps every request on the fast tier (cost cap). */
export function isSmartTierEnabled() {
  const value = process.env.OPENAI_MODEL_SMART?.trim().toLowerCase();
  return !(value === "off" || value === "none" || value === "disabled");
}

/** Smart tier model (OPENAI_MODEL_SMART, default gpt-6.1-sol), or null when disabled. */
export function getSmartModel(): string | null {
  return isSmartTierEnabled() ? resolveTierModel("smart") : null;
}

/** Short label for status endpoints, e.g. "gpt-6-luna → gpt-6.1-sol". */
export function describeModelRouting(): string {
  const fast = getOpenAiModel();
  const smart = getSmartModel();
  return smart && smart !== fast ? `${fast} → ${smart}` : fast;
}
