const DEFAULT_REDIRECT = "/inbox";

/**
 * Allow only same-origin relative paths. Blocks open redirects like `//evil.com`.
 */
export function sanitizeRedirectPath(
  path: string | null | undefined,
  fallback = DEFAULT_REDIRECT,
): string {
  if (!path || typeof path !== "string") return fallback;

  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("\\") || trimmed.includes("@") || trimmed.includes(":")) return fallback;

  return trimmed;
}
