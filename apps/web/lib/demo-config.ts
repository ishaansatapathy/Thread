import { env } from "~/env";

/** Demo login and demo UX are off unless explicitly enabled via env. */
export function isDemoLoginEnabled(): boolean {
  const flag = env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED ?? env.DEMO_LOGIN_ENABLED;
  return flag === "true";
}
