import { Router } from "express";
import { z } from "zod";
import { logger } from "@repo/logger";
import AuthService from "@repo/services/auth";
import { toAuthError } from "@repo/services/auth/errors";
import { sanitizeRedirectPath } from "@repo/services/auth/safe-redirect";
import { env } from "../env";

const authService = new AuthService();

export const googleAuthRouter = Router();

const googleCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

function decodeOAuthState(state: string | undefined) {
  if (!state) return null;
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const parsed = z
      .object({
        nonce: z.string().uuid(),
        returnTo: z.string().default("/inbox"),
      })
      .safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return {
      nonce: parsed.data.nonce,
      returnTo: sanitizeRedirectPath(parsed.data.returnTo),
    };
  } catch {
    return null;
  }
}

googleAuthRouter.get("/google/callback", async (req, res) => {
  const parsed = googleCallbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.redirect(
      `${env.CLIENT_URL}/sign-in?error=${encodeURIComponent("Invalid Google sign-in callback.")}`,
    );
  }

  const { code, state, error: oauthError, error_description: errorDescription } = parsed.data;

  if (oauthError) {
    return res.redirect(
      `${env.CLIENT_URL}/sign-in?error=${encodeURIComponent(errorDescription ?? "Google sign-in was cancelled or denied.")}`,
    );
  }

  if (!code) {
    return res.redirect(
      `${env.CLIENT_URL}/sign-in?error=${encodeURIComponent("Start sign-in from the sign-in page — do not open the callback URL directly.")}`,
    );
  }

  const oauthState = decodeOAuthState(state);
  const expectedNonce = req.cookies?.thread_oauth_state as string | undefined;
  res.clearCookie("thread_oauth_state", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production" || env.NODE_ENV === "prod",
    path: "/",
  });

  if (!oauthState || !expectedNonce || oauthState.nonce !== expectedNonce) {
    return res.redirect(
      `${env.CLIENT_URL}/sign-in?error=${encodeURIComponent("Google sign-in session expired. Please try again.")}`,
    );
  }

  try {
    const redirectUrl = await authService.handleGoogleCallback(code, res, oauthState.returnTo);
    return res.redirect(redirectUrl);
  } catch (error) {
    const authError = toAuthError(error, "Google sign-in failed. Please try again.");

    logger.error("Google OAuth callback failed", {
      message: authError.message,
      stack: authError.stack,
    });

    return res.redirect(`${env.CLIENT_URL}/sign-in?error=${encodeURIComponent(authError.message)}`);
  }
});
