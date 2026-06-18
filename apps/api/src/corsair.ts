import { Pool } from "pg";
import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { createPgPool } from "@repo/database/pg";

import { env } from "./env";
import { formatCorsairApprovalMessage } from "./services/corsair-approval";
import {
  buildGmailPluginOptions,
  buildGoogleCalendarPluginOptions,
} from "./services/corsair-plugin-config";

let pool: Pool | null = null;
let corsairInstance: ReturnType<typeof createCorsair> | null = null;

export function isCorsairConfigured() {
  return Boolean(process.env.CORSAIR_KEK?.trim() && process.env.DATABASE_URL?.trim());
}

export function isCorsairDevKeyConfigured() {
  return Boolean(process.env.CORSAIR_DEV_KEY?.trim());
}

/** API key for headless MCP clients (falls back to CORSAIR_DEV_KEY). */
export function getThreadMcpApiKey() {
  return process.env.THREAD_MCP_API_KEY?.trim() || process.env.CORSAIR_DEV_KEY?.trim() || null;
}

export function getCorsairPool() {
  if (!pool) {
    pool = createPgPool();
  }
  return pool;
}

export function getCorsair() {
  if (!isCorsairConfigured()) {
    throw new Error("Corsair is not configured. Set CORSAIR_KEK in .env");
  }

  if (!corsairInstance) {
    const kek = process.env.CORSAIR_KEK!.trim();
    corsairInstance = createCorsair({
      plugins: [
        gmail(buildGmailPluginOptions()),
        googlecalendar(buildGoogleCalendarPluginOptions()),
      ],
      database: getCorsairPool(),
      kek,
      multiTenancy: true,
      errorHandlers: {
        RATE_LIMIT_ERROR: {
          match: (error: unknown) => {
            const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
            const status =
              (error as { status?: number; response?: { status?: number } }).status ??
              (error as { response?: { status?: number } }).response?.status;
            return status === 429 || msg.includes("rate") || msg.includes("quota");
          },
          handler: async () => ({
            maxRetries: 4,
            retryStrategy: "exponential_backoff_jitter" as const,
          }),
        },
        DEFAULT: {
          match: () => true,
          handler: async (error: unknown) => {
            const status =
              (error as { status?: number; response?: { status?: number } }).status ??
              (error as { response?: { status?: number } }).response?.status;
            if (status !== undefined && status >= 500) {
              return { maxRetries: 2, retryStrategy: "exponential_backoff_jitter" as const };
            }
            return { maxRetries: 0 };
          },
        },
      },
      approval: {
        timeout: "30m",
        onTimeout: "deny",
        mode: "asynchronous",
        formatAsyncMessage: ({ token, plugin, endpoint }) =>
          formatCorsairApprovalMessage({ token, plugin, endpoint }),
      },
      connect: {
        baseUrl: `${env.CLIENT_URL}/connect`,
        redirectUri:
          process.env.CORSAIR_GMAIL_REDIRECT_URI?.trim() ??
          `${env.CLIENT_URL}/api-connect/gmail/callback`,
      },
    });
  }

  return corsairInstance;
}

export function getCorsairGmailRedirectUri() {
  return (
    process.env.CORSAIR_GMAIL_REDIRECT_URI?.trim() ??
    `${env.CLIENT_URL}/api-connect/gmail/callback`
  );
}

export function getCorsairCalendarRedirectUri() {
  return (
    process.env.CORSAIR_CALENDAR_REDIRECT_URI?.trim() ??
    `${env.CLIENT_URL}/api-connect/calendar/callback`
  );
}

