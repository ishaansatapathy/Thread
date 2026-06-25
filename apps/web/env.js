import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    /** Required by apps/web/proxy.ts for session verification (must match Railway API). */
    JWT_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16).optional(),
    API_INTERNAL_URL: z.string().url().optional(),
    DEMO_LOGIN_ENABLED: z.enum(["true", "false"]).optional(),
    DEMO_USER_EMAIL: z.string().optional(),
    DEMO_USER_PASSWORD: z.string().optional(),
    SEED_USER_EMAIL: z.string().optional(),
    SEED_DEMO_PASSWORD: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_API_URL: z.string().optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
    /** Mirrors DEMO_LOGIN_ENABLED for client-side demo gating. */
    NEXT_PUBLIC_DEMO_LOGIN_ENABLED: z.enum(["true", "false"]).optional(),
    NEXT_PUBLIC_DEMO_USER_EMAIL: z.string().optional(),
    /** Max demo Agent prompts (default 3). */
    NEXT_PUBLIC_DEMO_AGENT_LIMIT: z.coerce.number().optional(),
    NEXT_PUBLIC_DEMO_CALENDAR_LIMIT: z.coerce.number().optional(),
    NEXT_PUBLIC_DEMO_MAIL_LIMIT: z.coerce.number().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    API_INTERNAL_URL: process.env.API_INTERNAL_URL,
    DEMO_LOGIN_ENABLED: process.env.DEMO_LOGIN_ENABLED,
    DEMO_USER_EMAIL: process.env.DEMO_USER_EMAIL,
    DEMO_USER_PASSWORD: process.env.DEMO_USER_PASSWORD,
    SEED_USER_EMAIL: process.env.SEED_USER_EMAIL,
    SEED_DEMO_PASSWORD: process.env.SEED_DEMO_PASSWORD,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY,
    NEXT_PUBLIC_DEMO_LOGIN_ENABLED:
      process.env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED ?? process.env.DEMO_LOGIN_ENABLED,
    NEXT_PUBLIC_DEMO_USER_EMAIL: process.env.NEXT_PUBLIC_DEMO_USER_EMAIL,
    NEXT_PUBLIC_DEMO_AGENT_LIMIT: process.env.NEXT_PUBLIC_DEMO_AGENT_LIMIT,
    NEXT_PUBLIC_DEMO_CALENDAR_LIMIT: process.env.NEXT_PUBLIC_DEMO_CALENDAR_LIMIT,
    NEXT_PUBLIC_DEMO_MAIL_LIMIT: process.env.NEXT_PUBLIC_DEMO_MAIL_LIMIT,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
