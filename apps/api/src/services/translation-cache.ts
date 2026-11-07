/**
 * Translate once, reuse everywhere. Live call dubbing and "Translate + listen" both translate short
 * texts into a handful of languages, often the same phrases again and again (greetings, "okay",
 * repeated terms). The result is kept here so the Gnani voice step can start straight away instead of
 * waiting on another model call. In-memory and size-capped — a miss just costs one translation.
 */
import { createHash } from "node:crypto";

const MAX_ENTRIES = 2000;
const TTL_MS = 6 * 60 * 60 * 1000;

type Entry = { value: string; at: number };
const store = new Map<string, Entry>();

function keyOf(scope: string, target: string, text: string) {
  return `${scope}:${target}:${createHash("sha1").update(text.trim().toLowerCase()).digest("hex")}`;
}

export function getCachedTranslation(scope: string, target: string, text: string): string | null {
  const key = keyOf(scope, target, text);
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  // Re-insert so the Map's order tracks recency.
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

export function cacheTranslation(scope: string, target: string, text: string, value: string) {
  if (!value.trim()) return;
  const key = keyOf(scope, target, text);
  store.delete(key);
  store.set(key, { value, at: Date.now() });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Translate through the cache: `scope` keeps users' translations apart. */
export async function translateCached(
  scope: string,
  target: string,
  text: string,
  translate: () => Promise<string>,
): Promise<{ translation: string; cached: boolean }> {
  const hit = getCachedTranslation(scope, target, text);
  if (hit !== null) return { translation: hit, cached: true };
  const translation = await translate();
  cacheTranslation(scope, target, text, translation);
  return { translation, cached: false };
}
