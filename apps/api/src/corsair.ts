import { Pool } from "pg";
import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { createPgPool } from "@repo/database/pg";

import { env } from "./env";
import {
  buildGmailWebhookHooks,
  buildGoogleCalendarWebhookHooks,
} from "./services/corsair-webhook-sync";

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
        gmail({ webhookHooks: buildGmailWebhookHooks() }),
        googlecalendar({ webhookHooks: buildGoogleCalendarWebhookHooks() }),
      ],
      database: getCorsairPool(),
      kek,
      multiTenancy: true,
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

