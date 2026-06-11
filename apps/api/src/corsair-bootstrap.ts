import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";

import { getCorsair, getCorsairGmailRedirectUri, isCorsairConfigured } from "./corsair";
import { getCorsairSetupModule } from "./corsair-imports";
export async function bootstrapCorsair() {
  if (!isCorsairConfigured()) {
    logger.warn("Corsair skipped — CORSAIR_KEK is not set");
    return;
  }

  const google = getGoogleOAuthConfig();
  if (!google.clientId || !google.clientSecret) {
    logger.warn("Corsair Gmail skipped — GOOGLE_OAUTH_CLIENT_ID/SECRET not configured");
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
