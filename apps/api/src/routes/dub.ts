/**
 * /dub — bring a video in (upload or link). GET /dub/jobs/:id/video streams it back
 * with Range support so the browser can preview it.
 */
import express, { Router } from "express";
import AuthService from "@repo/services/auth";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";
import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";

import { DUB_SOURCE_LANGUAGES, isDubSourceLanguage, startDub } from "../services/dub-pipeline";
import { DUB_TARGETS, isDubTarget } from "../services/dub-translate";
import {
  MAX_DUB_SECONDS,
  MAX_DUB_VIDEO_BYTES,
  createFromLink,
  createFromUpload,
  deleteJob,
  getJob,
  listJobs,
  toPublicJob,
} from "../services/dub";

const authService = new AuthService();

export const dubRouter = Router();

function sendError(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof ServiceError) {
    return res.status(error.code === "PRECONDITION_FAILED" ? 412 : 400).json({ error: error.message });
  }
  logger.warn("dub.request_failed", { message: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: fallback });
}

dubRouter.get("/jobs", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  return res.json({ jobs: listJobs(user.id) });
});

dubRouter.get("/jobs/:id", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const job = getJob(user.id, String(req.params.id));
  if (!job) return res.status(404).json({ error: "Video not found" });
  return res.json(toPublicJob(job));
});

dubRouter.get("/jobs/:id/video", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const job = getJob(user.id, String(req.params.id));
  if (!job || job.status !== "ready" || !job.filePath) return res.status(404).json({ error: "Video not found" });
  return res.type(job.mimeType).sendFile(job.filePath, { acceptRanges: true });
});

dubRouter.post("/jobs", express.json({ limit: "8kb" }), async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  if (process.env.VITEST !== "true") {
    const limit = await checkDistributedRateLimit(`dub:${user.id}`, 20, 60_000);
    if (!limit.allowed) return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }

  const url = typeof req.body?.url === "string" ? req.body.url : "";
  if (!url.trim()) return res.status(400).json({ error: "Paste a video link" });

  try {
    return res.status(202).json(await createFromLink(user.id, url));
  } catch (error) {
    return sendError(res, error, "Could not start that download");
  }
});

dubRouter.post(
  "/jobs/upload",
  express.raw({ type: () => true, limit: MAX_DUB_VIDEO_BYTES + 1024 }),
  async (req, res) => {
    const user = await authService.resolveSession(req, res);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    if (process.env.VITEST !== "true") {
      const limit = await checkDistributedRateLimit(`dub:${user.id}`, 20, 60_000);
      if (!limit.allowed) return res.status(429).json({ error: "Too many requests. Try again in a minute." });
    }

    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      return res.status(400).json({ error: "Send the video as the request body" });
    }

    let filename = "video.mp4";
    try {
      filename = decodeURIComponent(String(req.header("x-file-name") ?? "video.mp4"));
    } catch {
      /* keep default */
    }
    const mimeType = String(req.header("x-file-type") ?? "").trim() || "application/octet-stream";

    try {
      return res.status(201).json(await createFromUpload(user.id, { filename, mimeType, data: req.body }));
    } catch (error) {
      return sendError(res, error, "Could not store the video");
    }
  },
);

dubRouter.get("/options", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  return res.json({ targets: DUB_TARGETS, sources: DUB_SOURCE_LANGUAGES, maxSeconds: MAX_DUB_SECONDS });
});

dubRouter.post("/jobs/:id/dub", express.json({ limit: "4kb" }), async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  if (process.env.VITEST !== "true") {
    const limit = await checkDistributedRateLimit(`dub-run:${user.id}`, 6, 60 * 60_000);
    if (!limit.allowed) return res.status(429).json({ error: "Dub limit reached for this hour. Try again later." });
  }

  const job = getJob(user.id, String(req.params.id));
  if (!job) return res.status(404).json({ error: "Video not found" });

  const target = String(req.body?.target ?? "");
  const source = String(req.body?.source ?? "hi-IN");
  if (!isDubTarget(target)) return res.status(400).json({ error: "Pick a language to dub into" });
  if (!isDubSourceLanguage(source)) return res.status(400).json({ error: "Unsupported source language" });

  try {
    startDub(job, target, source);
    return res.status(202).json(toPublicJob(job));
  } catch (error) {
    return sendError(res, error, "Could not start dubbing");
  }
});

dubRouter.get("/jobs/:id/output", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const job = getJob(user.id, String(req.params.id));
  const output = job?.dub?.status === "done" ? job.dub.outputPath : null;
  if (!job || !output) return res.status(404).json({ error: "Dubbed video not found" });
  if (req.query.download === "1") {
    const safeTitle = job.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "video";
    return res.download(output, `${safeTitle} (${job.dub!.target} dub).mp4`);
  }
  return res.type("video/mp4").sendFile(output, { acceptRanges: true });
});

dubRouter.delete("/jobs/:id", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const removed = await deleteJob(user.id, String(req.params.id));
  return removed ? res.json({ ok: true }) : res.status(404).json({ error: "Video not found" });
});

dubRouter.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Videos can be up to 200 MB." });
  return next(err);
});
