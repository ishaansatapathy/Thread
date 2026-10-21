/**
 * What Thread knows about OpenAI models: which tier uses which model, which
 * request parameters each model accepts, and when old models shut down.
 *
 * Source: developers.openai.com/api/docs/models and /deprecations (Oct 2026).
 * When OpenAI ships or retires models, update DEFAULTS and DEPRECATIONS here;
 * nothing else in the codebase hardcodes model IDs.
 */
import { logger } from "@repo/logger";

export type ModelTier = "fast" | "smart";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** fast = high-volume, low-latency work. smart = near-flagship quality at a fraction of the flagship price. */
export const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "gpt-6-luna",
  smart: "gpt-6.1-sol",
};

type ModelSpec = {
  /** Effort values the model accepts; empty = not a reasoning model (no `reasoning` param). */
  efforts: ReasoningEffort[];
  /** Pre-reasoning models accept temperature; reasoning models are steered by effort instead. */
  temperature: boolean;
};

const ALL_EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const KNOWN_MODELS: Record<string, ModelSpec> = {
  "gpt-6-luna": { efforts: ["none", "low", "medium", "high", "xhigh", "max"], temperature: false },
  "gpt-6.1-sol": { efforts: ["low", "medium", "high", "xhigh", "max"], temperature: false },
  "gpt-6-sol": { efforts: ["low", "medium", "high", "xhigh", "max"], temperature: false },
  "gpt-6-astra": { efforts: ["low", "medium", "high", "xhigh", "max"], temperature: false },
};

/** Models OpenAI has scheduled for shutdown, with the dates from the deprecations page. */
const DEPRECATIONS: Record<string, string> = {
  "gpt-4o-mini": "2027-01-14",
  "gpt-4o-mini-2024-07-18": "2027-01-14",
  "gpt-4o": "2027-01-14",
  "gpt-4o-2024-08-06": "2027-01-14",
  "gpt-4o-2024-11-20": "2027-01-14",
  "gpt-4o-2024-05-13": "2026-10-23",
  "gpt-4.1": "2027-01-14",
  "gpt-4.1-2025-04-14": "2027-01-14",
  "gpt-4.1-mini": "2027-01-14",
  "gpt-4.1-mini-2025-04-14": "2027-01-14",
  "gpt-4.1-nano": "2026-10-23",
  "o3-mini": "2026-10-23",
  "o4-mini": "2026-10-23",
  "o3": "2026-12-11",
  "gpt-5": "2026-12-11",
  "gpt-5-mini": "2026-12-11",
  "gpt-5-nano": "2026-12-11",
  "gpt-5.1": "2027-04-01",
  "gpt-5.4-nano": "2027-04-01",
  "gpt-3.5-turbo": "2026-10-23",
  "gpt-4": "2026-10-23",
  "gpt-4-turbo": "2026-10-23",
};

function isLegacyChatModel(model: string) {
  return /^(gpt-3\.5|gpt-4)(?!\.5)/.test(model);
}

export function getModelSpec(model: string): ModelSpec {
  const known = KNOWN_MODELS[model];
  if (known) return known;
  if (isLegacyChatModel(model)) return { efforts: [], temperature: true };
  // Unknown newer model: assume a current reasoning model with the common effort range.
  return { efforts: ["low", "medium", "high"], temperature: false };
}

/** Closest effort the model accepts, never cheaper-than-asked when possible. */
export function clampEffort(model: string, desired: ReasoningEffort): ReasoningEffort | undefined {
  const { efforts } = getModelSpec(model);
  if (efforts.length === 0) return undefined;
  if (efforts.includes(desired)) return desired;
  const wanted = ALL_EFFORTS.indexOf(desired);
  return (
    ALL_EFFORTS.slice(wanted).find((e) => efforts.includes(e)) ??
    ALL_EFFORTS.slice(0, wanted).reverse().find((e) => efforts.includes(e))
  );
}

const warned = new Set<string>();

function warnOnce(key: string, message: string, meta: Record<string, unknown>) {
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn(message, meta);
}

/**
 * Resolves the model for a tier from env, guarding against retired models:
 * past its shutdown date → fall back to the tier default (requests would 404);
 * scheduled for shutdown → keep it, but warn once so it gets changed.
 */
export function resolveTierModel(tier: ModelTier, now: Date = new Date()): string {
  const envKey = tier === "fast" ? "OPENAI_MODEL" : "OPENAI_MODEL_SMART";
  const configured = process.env[envKey]?.trim();
  if (!configured) return DEFAULT_MODELS[tier];

  const shutdown = DEPRECATIONS[configured];
  if (!shutdown) return configured;

  if (now >= new Date(`${shutdown}T00:00:00Z`)) {
    warnOnce(`${envKey}:retired`, "openai.model_retired_fallback", {
      envKey,
      configured,
      shutdown,
      using: DEFAULT_MODELS[tier],
    });
    return DEFAULT_MODELS[tier];
  }
  warnOnce(`${envKey}:deprecated`, "openai.model_deprecated", {
    envKey,
    configured,
    shutdown,
    recommended: DEFAULT_MODELS[tier],
  });
  return configured;
}

export function isModelDeprecated(model: string): { shutdown: string } | null {
  const shutdown = DEPRECATIONS[model];
  return shutdown ? { shutdown } : null;
}
