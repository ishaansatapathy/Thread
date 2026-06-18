import { Router } from "express";
import { z } from "zod";
import { logger } from "@repo/logger";
import AuthService from "@repo/services/auth";
import { sanitizeRedirectPath } from "@repo/services/auth/safe-redirect";

import { env } from "../env";
import { CorsairCalendarService } from "../services/calendar";
import { CorsairInboxService, invalidateConnectionCache } from "../services/inbox";
import { backfillCorsairTenant } from "../services/corsair-backfill";
import { isCorsairConfigured } from "../corsair";

const authService = new AuthService();
const inboxService = new CorsairInboxService();
const calendarService = new CorsairCalendarService();

export const corsairAuthRouter = Router();

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

function decodeReturnTo(state: string | undefined, fallback = "/inbox") {
  if (!state) return fallback;
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const parsed = z.object({ returnTo: z.string() }).safeParse(JSON.parse(raw));
    if (!parsed.success) return fallback;
    return sanitizeRedirectPath(parsed.data.returnTo);
  } catch {
    return fallback;
  }
}

function encodeReturnTo(returnTo: string) {
  return Buffer.from(JSON.stringify({ returnTo: sanitizeRedirectPath(returnTo) }), "utf8").toString(
    "base64url",
  );
}

function readReturnTo(req: { cookies?: Record<string, string | undefined> }, cookieName: string, fallback: string) {
  const cookie = req.cookies?.[cookieName] as string | undefined;
  return decodeReturnTo(cookie, fallback);
}

function clearOAuthCookie(
  res: { clearCookie: (name: string, options: Record<string, unknown>) => void },
  cookieName: string,
) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production" || env.NODE_ENV === "prod",
    path: "/",
  });
}

function setOAuthCookie(
  res: { cookie: (name: string, value: string, options: Record<string, unknown>) => void },
  cookieName: string,
  returnTo: string,
) {
  res.cookie(cookieName, encodeReturnTo(returnTo), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production" || env.NODE_ENV === "prod",
    path: "/",
    maxAge: 15 * 60,
  });
}

corsairAuthRouter.get("/gmail", async (req, res) => {
  if (!isCorsairConfigured() || !inboxService.isConfigured()) {
    return res.redirect(
      `${env.CLIENT_URL}/inbox?error=${encodeURIComponent("Gmail integration is not configured on the server.")}`,
    );
  }

  const user = await authService.resolveSession(req, res);
  if (!user) {
    return res.redirect(`${env.CLIENT_URL}/sign-in?returnTo=${encodeURIComponent("/inbox")}`);
  }

  const returnTo = sanitizeRedirectPath(
    typeof req.query.state === "string" ? req.query.state : "/inbox",
  );

  try {
    const { url } = await inboxService.getGmailConnectUrl(user.id, returnTo);
    setOAuthCookie(res, "thread_gmail_oauth", returnTo);
    return res.redirect(url);
  } catch (error) {
    logger.error("Gmail connect start failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.redirect(
      `${env.CLIENT_URL}/inbox?error=${encodeURIComponent("Could not start Gmail connection. Try again.")}`,
    );
  }
});

corsairAuthRouter.get("/gmail/callback", async (req, res) => {
  const parsed = callbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.redirect(
      `${env.CLIENT_URL}/inbox?error=${encodeURIComponent("Invalid Gmail callback.")}`,
    );
  }

  const { code, state, error: oauthError, error_description: errorDescription } = parsed.data;

  if (oauthError) {
    return res.redirect(
      `${env.CLIENT_URL}/inbox?error=${encodeURIComponent(errorDescription ?? "Gmail connection was cancelled.")}`,
    );
  }

  if (!code || !state) {
    return res.redirect(
      `${env.CLIENT_URL}/inbox?error=${encodeURIComponent("Gmail authorization did not complete.")}`,
    );
  }

  const returnTo = readReturnTo(req, "thread_gmail_oauth", "/inbox");
  clearOAuthCookie(res, "thread_gmail_oauth");

  try {
    await inboxService.completeGmailOAuth({ code, state });
    const user = await authService.resolveSession(req, res);
    if (user) {
      invalidateConnectionCache(user.id);
      void backfillCorsairTenant(user.id);
      // Register Gmail Pub/Sub watch when topic is configured (best-effort).
      void inboxService.registerGmailWatch(user.id).catch((err: unknown) => {
        logger.warn("Gmail watch registration failed (non-critical)", {
          userId: user.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return res.redirect(`${env.CLIENT_URL}${returnTo}?gmail=connected`);
  } catch (error) {
    logger.error("Gmail OAuth callback failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.redirect(
      `${env.CLIENT_URL}${returnTo}?error=${encodeURIComponent("Gmail connection failed. Check Google OAuth redirect URI and Gmail scopes.")}`,
    );
  }
});

corsairAuthRouter.get("/calendar", async (req, res) => {
  if (!isCorsairConfigured() || !calendarService.isConfigured()) {
    return res.redirect(
      `${env.CLIENT_URL}/calendar?error=${encodeURIComponent("Calendar integration is not configured on the server.")}`,
    );
  }

  const user = await authService.resolveSession(req, res);
  if (!user) {
    return res.redirect(`${env.CLIENT_URL}/sign-in?returnTo=${encodeURIComponent("/calendar")}`);
  }

  const returnTo = sanitizeRedirectPath(
    typeof req.query.state === "string" ? req.query.state : "/calendar",
  );

  try {
    const { url } = await calendarService.getCalendarConnectUrl(user.id);
    setOAuthCookie(res, "thread_calendar_oauth", returnTo);
    return res.redirect(url);
  } catch (error) {
    logger.error("Calendar connect start failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.redirect(
      `${env.CLIENT_URL}/calendar?error=${encodeURIComponent("Could not start Calendar connection. Try again.")}`,
    );
  }
});

corsairAuthRouter.get("/calendar/callback", async (req, res) => {
  const parsed = callbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.redirect(
      `${env.CLIENT_URL}/calendar?error=${encodeURIComponent("Invalid Calendar callback.")}`,
    );
  }

  const { code, state, error: oauthError, error_description: errorDescription } = parsed.data;

  if (oauthError) {
    return res.redirect(
      `${env.CLIENT_URL}/calendar?error=${encodeURIComponent(errorDescription ?? "Calendar connection was cancelled.")}`,
    );
  }

  if (!code || !state) {
    return res.redirect(
      `${env.CLIENT_URL}/calendar?error=${encodeURIComponent("Calendar authorization did not complete.")}`,
    );
  }

  const returnTo = readReturnTo(req, "thread_calendar_oauth", "/calendar");
  clearOAuthCookie(res, "thread_calendar_oauth");

  try {
    await calendarService.completeCalendarOAuth({ code, state });

    // Register a Calendar push-notification channel (webhook) if a base URL is configured.
    // This is best-effort; failure should never block the OAuth redirect.
    const webhooksBaseUrl = process.env.WEBHOOKS_BASE_URL?.trim() || env.BASE_URL;
    if (webhooksBaseUrl) {
      const user = await authService.resolveSession(req, res);
      if (user) {
        void backfillCorsairTenant(user.id);
        void calendarService.registerWebhook(user.id, `${webhooksBaseUrl}/webhooks/calendar`).catch(
          (err: unknown) => {
            logger.warn("Calendar webhook registration failed (non-critical)", {
              userId: user.id,
              message: err instanceof Error ? err.message : String(err),
            });
          },
        );
      }
    }

    return res.redirect(`${env.CLIENT_URL}${returnTo}?calendar=connected`);
  } catch (error) {
    logger.error("Calendar OAuth callback failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.redirect(
      `${env.CLIENT_URL}${returnTo}?error=${encodeURIComponent("Calendar connection failed. Check Google OAuth redirect URI and Calendar scopes.")}`,
    );
  }
});

