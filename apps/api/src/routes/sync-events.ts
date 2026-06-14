/**
 * Tenant-scoped SSE — pushes inbox/calendar invalidation hints after webhooks refresh cache.
 * Client listens in thread-app-shell and invalidates React Query caches.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "@repo/logger";
import { authService } from "@repo/trpc/server/services";

import { subscribeSyncEvents, type SyncEvent } from "../services/sync-events";

export const syncEventsRouter = Router();

const HEARTBEAT_MS = 25_000;

syncEventsRouter.get("/", async (req: Request, res: Response) => {
  const user = await authService.resolveSession(req, res);
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  }

  const onSync = (event: SyncEvent) => {
    send("sync", { type: event.type, at: event.at });
  };

  const unsubscribe = subscribeSyncEvents(user.id, onSync);
  send("ready", { ok: true });

  const heartbeat = setInterval(() => {
    send("ping", { ts: Date.now() });
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    logger.debug("sync-events.client disconnected", { userId: user.id });
  });
});
