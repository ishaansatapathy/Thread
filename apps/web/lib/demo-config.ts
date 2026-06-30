import { env } from "~/env";

/** Demo login and demo UX are off unless explicitly enabled via env. */
export function isDemoLoginEnabled(): boolean {
  // Client-safe only — never read server env (DEMO_LOGIN_ENABLED) here; t3-env throws on client.
  return env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED === "true";
}
