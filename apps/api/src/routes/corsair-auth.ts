import { Router } from "express";
import { z } from "zod";
import { logger } from "@repo/logger";
import AuthService from "@repo/services/auth";
import { sanitizeRedirectPath } from "@repo/services/auth/safe-redirect";

import { env } from "../env";
import { CorsairInboxService } from "../services/inbox";
import { isCorsairConfigured } from "../corsair";

const authService = new AuthService();
const inboxService = new CorsairInboxService();

export const corsairAuthRouter = Router();

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

function decodeReturnTo(state: string | undefined) {
  if (!state) return "/inbox";
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const parsed = z.object({ returnTo: z.string() }).safeParse(JSON.parse(raw));
    if (!parsed.success) return "/inbox";
    return sanitizeRedirectPath(parsed.data.returnTo);
  } catch {
    return "/inbox";
  }
}

function encodeReturnTo(returnTo: string) {
  return Buffer.from(JSON.stringify({ returnTo: sanitizeRedirectPath(returnTo) }), "utf8").toString(
    "base64url",
  );
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
    res.cookie("thread_gmail_oauth", encodeReturnTo(returnTo), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production" || env.NODE_ENV === "prod",
      path: "/",
      maxAge: 15 * 60,
    });
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

  const returnToCookie = req.cookies?.thread_gmail_oauth as string | undefined;
  res.clearCookie("thread_gmail_oauth", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production" || env.NODE_ENV === "prod",
    path: "/",
  });
  const returnTo = decodeReturnTo(returnToCookie);

  try {
    await inboxService.completeGmailOAuth({ code, state });
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
