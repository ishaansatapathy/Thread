/**
 * Thread browser extension auth.
 *   POST /extension/token  — signed-in web session → 30-day bearer token for the extension
 *   GET  /extension/me     — bearer token → who the extension is connected as
 */
import { Router } from "express";
import AuthService from "@repo/services/auth";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";
import { logger } from "@repo/logger";

const authService = new AuthService();

export const extensionRouter = Router();

extensionRouter.post("/token", async (req, res) => {
  // Tokens are only minted from a real cookie session, never from another bearer token.
  if (!req.headers.cookie) return res.status(401).json({ error: "Sign in to Thread first." });
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Sign in to Thread first." });

  if (process.env.VITEST !== "true") {
    const limit = await checkDistributedRateLimit(`extension-token:${user.id}`, 10, 60_000);
    if (!limit.allowed) return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }

  try {
    const issued = await authService.createExtensionToken(user.id);
    return res.json({ ...issued, email: user.email, name: user.displayName ?? user.fullName });
  } catch (error) {
    logger.warn("extension.token_failed", { message: error instanceof Error ? error.message : String(error) });
    return res.status(401).json({ error: "Sign in to Thread again to connect the extension." });
  }
});

extensionRouter.get("/me", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "The extension isn't connected." });
  return res.json({ id: user.id, email: user.email, name: user.displayName ?? user.fullName });
});
