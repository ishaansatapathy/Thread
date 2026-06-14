import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";

import {
  getCorsair,
  getCorsairCalendarRedirectUri,
  getCorsairGmailRedirectUri,
  isCorsairConfigured,
  isCorsairDevKeyConfigured,
} from "./corsair";
import { getCorsairSetupModule } from "./corsair-imports";

export async function bootstrapCorsair() {
  if (!isCorsairConfigured()) {
    logger.warn("Corsair skipped — CORSAIR_KEK is not set");
    return;
  }

  if (!isCorsairDevKeyConfigured()) {
    logger.info("CORSAIR_DEV_KEY not set — Corsair dashboard CLI features may be limited");
  }

  const google = getGoogleOAuthConfig();
  if (!google.clientId || !google.clientSecret) {
    logger.warn("Corsair skipped — GOOGLE_OAUTH_CLIENT_ID/SECRET not configured");
    return;
  }

  try {
    const corsair = getCorsair();
    const { setupCorsair } = getCorsairSetupModule();
    const output = await setupCorsair(corsair, {
      caller: "script",
      credentials: {
        gmail: {
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_url: getCorsairGmailRedirectUri(),
        },
        googlecalendar: {
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_url: getCorsairCalendarRedirectUri(),
        },
      },
    });

    if (output.trim()) {
      logger.info("Corsair setup", { output: output.trim() });
    }
  } catch (error) {
    logger.error("Corsair bootstrap failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
