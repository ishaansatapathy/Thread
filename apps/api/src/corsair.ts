import { Pool } from "pg";
import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";

import { env } from "./env";

let pool: Pool | null = null;
let corsairInstance: ReturnType<typeof createCorsair> | null = null;

export function isCorsairConfigured() {
  return Boolean(process.env.CORSAIR_KEK?.trim() && process.env.DATABASE_URL?.trim());
}

export function getCorsairPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for Corsair");
    }
    pool = new Pool({ connectionString });
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
      plugins: [gmail(), googlecalendar()],
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
