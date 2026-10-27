/**
 * Dub ingest: turns an uploaded file or a link (YouTube, Google Drive, direct video URL,
 * any site yt-dlp understands) into a source video on disk. Dubbing runs on top of this.
 * Jobs live in memory + the OS temp dir and expire after JOB_TTL_MS.
 */
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";

import { probeDuration, runProcess } from "./dub-media";
import type { DubRun } from "./dub-pipeline";

export const MAX_DUB_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_DUB_SECONDS = 5 * 60;
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_JOBS_PER_USER = 8;
const YTDLP_TIMEOUT_MS = 10 * 60 * 1000;
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"];

export type DubJobStatus = "downloading" | "ready" | "error";
export type DubSourceKind = "upload" | "youtube" | "drive" | "direct" | "web";

export interface DubJob {
  id: string;
  userId: string;
  status: DubJobStatus;
  sourceKind: DubSourceKind;
  sourceLabel: string;
  title: string;
  sizeBytes: number | null;
  error: string | null;
  createdAt: number;
  filePath: string | null;
  mimeType: string;
  durationSeconds: number | null;
  dub: DubRun | null;
}

export type PublicDubJob = Omit<DubJob, "userId" | "filePath" | "dub"> & {
  dub: Omit<DubRun, "outputPath" | "voiceIds"> | null;
};

const jobs = new Map<string, DubJob>();
export const baseDir = path.join(os.tmpdir(), "thread-dub");

export function jobDir(id: string) {
  return path.join(baseDir, id);
}

export function toPublicJob(job: DubJob): PublicDubJob {
  const dub = job.dub;
  return {
    id: job.id,
    status: job.status,
    sourceKind: job.sourceKind,
    sourceLabel: job.sourceLabel,
    title: job.title,
    sizeBytes: job.sizeBytes,
    error: job.error,
    createdAt: job.createdAt,
    mimeType: job.mimeType,
    durationSeconds: job.durationSeconds,
    dub: dub
      ? {
          status: dub.status,
          stage: dub.stage,
          progress: dub.progress,
          target: dub.target,
          sourceLanguage: dub.sourceLanguage,
          transcriber: dub.transcriber,
          syncScore: dub.syncScore,
          error: dub.error,
          notice: dub.notice,
          lines: dub.lines,
          lipsync: dub.lipsync,
          startedAt: dub.startedAt,
          finishedAt: dub.finishedAt,
        }
      : null,
  };
}

async function enforceDuration(job: DubJob) {
  if (!job.filePath) return;
  const seconds = await probeDuration(job.filePath);
  job.durationSeconds = Math.round(seconds * 10) / 10;
  if (seconds > MAX_DUB_SECONDS + 1) {
    await rm(job.filePath, { force: true });
    job.filePath = null;
    throw new ServiceError("BAD_REQUEST", `Videos can be up to ${MAX_DUB_SECONDS / 60} minutes for now.`);
  }
}

export function listJobs(userId: string): PublicDubJob[] {
  return [...jobs.values()]
    .filter((j) => j.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublicJob);
}

export function getJob(userId: string, id: string): DubJob | null {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : null;
}

export async function deleteJob(userId: string, id: string): Promise<boolean> {
  const job = getJob(userId, id);
  if (!job) return false;
  jobs.delete(id);
  await rm(path.join(baseDir, id), { recursive: true, force: true });
  return true;
}

function assertCapacity(userId: string) {
  const active = [...jobs.values()].filter((j) => j.userId === userId).length;
  if (active >= MAX_JOBS_PER_USER) {
    throw new ServiceError("BAD_REQUEST", "Too many videos in your Dub list. Delete one first.");
  }
}

function newJob(userId: string, sourceKind: DubSourceKind, sourceLabel: string, title: string): DubJob {
  assertCapacity(userId);
  const job: DubJob = {
    id: randomUUID(),
    userId,
    status: "downloading",
    sourceKind,
    sourceLabel,
    title,
    sizeBytes: null,
    error: null,
    createdAt: Date.now(),
    filePath: null,
    mimeType: "video/mp4",
    durationSeconds: null,
    dub: null,
  };
  jobs.set(job.id, job);
  return job;
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    default:
      return "video/mp4";
  }
}

function fail(job: DubJob, message: string) {
  job.status = "error";
  job.error = message;
}

export async function createFromUpload(
  userId: string,
  file: { filename: string; mimeType: string; data: Buffer },
): Promise<PublicDubJob> {
  const ext = path.extname(file.filename).toLowerCase();
  const looksLikeVideo = file.mimeType.startsWith("video/") || VIDEO_EXTENSIONS.includes(ext);
  if (!looksLikeVideo) throw new ServiceError("BAD_REQUEST", "Upload a video file (mp4, mov, webm, mkv).");
  if (file.data.byteLength > MAX_DUB_VIDEO_BYTES) {
    throw new ServiceError("BAD_REQUEST", "Videos can be up to 200 MB.");
  }

  const safeExt = VIDEO_EXTENSIONS.includes(ext) ? ext : ".mp4";
  const job = newJob(userId, "upload", file.filename, file.filename.replace(/\.[^.]+$/, "") || "Uploaded video");
  const dir = path.join(baseDir, job.id);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `source${safeExt}`);
  await writeFile(filePath, file.data);
  job.filePath = filePath;
  job.sizeBytes = file.data.byteLength;
  job.mimeType = mimeForExt(safeExt);
  try {
    await enforceDuration(job);
  } catch (error) {
    await deleteJob(userId, job.id);
    throw error;
  }
  job.status = "ready";
  return toPublicJob(job);
}

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const a = address.toLowerCase();
    return (
      a === "::1" ||
      a === "::" ||
      a.startsWith("fc") ||
      a.startsWith("fd") ||
      a.startsWith("fe80") ||
      a.startsWith("::ffff:127.") ||
      a.startsWith("::ffff:10.") ||
      a.startsWith("::ffff:192.168.") ||
      a.startsWith("::ffff:169.254.")
    );
  }
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceError("BAD_REQUEST", "That doesn't look like a valid link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServiceError("BAD_REQUEST", "Only http(s) links are supported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ServiceError("BAD_REQUEST", "That link points to a private address.");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new ServiceError("BAD_REQUEST", "Could not reach that link.");
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ServiceError("BAD_REQUEST", "That link points to a private address.");
  }
  return url;
}

function classify(url: URL): { kind: DubSourceKind; driveId?: string } {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    return { kind: "youtube" };
  }
  if (host === "drive.google.com" || host === "docs.google.com") {
    const match = url.pathname.match(/\/file\/d\/([\w-]+)/) ?? null;
    const id = match?.[1] ?? url.searchParams.get("id");
    if (id) return { kind: "drive", driveId: id };
  }
  if (VIDEO_EXTENSIONS.some((ext) => url.pathname.toLowerCase().endsWith(ext))) return { kind: "direct" };
  return { kind: "web" };
}

export async function createFromLink(userId: string, rawUrl: string): Promise<PublicDubJob> {
  const url = await assertPublicUrl(rawUrl.trim());
  const { kind, driveId } = classify(url);
  const job = newJob(userId, kind, url.toString(), url.hostname);
  const dir = path.join(baseDir, job.id);

  void (async () => {
    try {
      await mkdir(dir, { recursive: true });
      if (kind === "drive" && driveId) {
        await downloadDirect(job, dir, `https://drive.google.com/uc?export=download&id=${driveId}`);
      } else if (kind === "direct") {
        await downloadDirect(job, dir, url.toString());
      } else {
        await downloadWithYtdlp(job, dir, url.toString());
      }
      await enforceDuration(job);
      job.status = "ready";
    } catch (error) {
      const message = error instanceof ServiceError ? error.message : "Could not download that video.";
      if (!(error instanceof ServiceError)) {
        logger.warn("dub.download_failed", { jobId: job.id, kind, message: error instanceof Error ? error.message : String(error) });
      }
      fail(job, message);
    }
  })();

  return toPublicJob(job);
}

async function downloadDirect(job: DubJob, dir: string, startUrl: string) {
  let current = startUrl;
  let response: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current);
    response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(5 * 60 * 1000) });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
  if (!response || !response.ok || !response.body) {
    throw new ServiceError("BAD_REQUEST", "That link didn't return a downloadable video. Make sure it's public.");
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType.startsWith("text/html")) {
    throw new ServiceError(
      "BAD_REQUEST",
      job.sourceKind === "drive"
        ? "Drive blocked the download. Set sharing to 'Anyone with the link' (large files need a manual download)."
        : "That link is a web page, not a video file.",
    );
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_DUB_VIDEO_BYTES) throw new ServiceError("BAD_REQUEST", "Videos can be up to 200 MB.");

  const ext = VIDEO_EXTENSIONS.find((e) => new URL(current).pathname.toLowerCase().endsWith(e)) ?? ".mp4";
  const filePath = path.join(dir, `source${ext}`);
  let received = 0;
  const limiter = new TransformCap(MAX_DUB_VIDEO_BYTES, (n) => (received = n));
  await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(filePath));

  job.filePath = filePath;
  job.sizeBytes = received;
  job.mimeType = mimeForExt(ext);
  if (job.sourceKind === "drive") {
    const cd = response.headers.get("content-disposition") ?? "";
    const name = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
    if (name) job.title = decodeURIComponent(name).replace(/\.[^.]+$/, "");
  }
}

class TransformCap extends Transform {
  private total = 0;
  constructor(
    private readonly max: number,
    private readonly onProgress: (n: number) => void,
  ) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null, data?: Buffer) => void) {
    this.total += chunk.byteLength;
    this.onProgress(this.total);
    if (this.total > this.max) return cb(new ServiceError("BAD_REQUEST", "Videos can be up to 200 MB."));
    cb(null, chunk);
  }
}

/**
 * YouTube intermittently answers 403 for yt-dlp's default clients; retry with another client.
 * Which clients work changes as YouTube changes — re-check with yt-dlp updates.
 */
const YOUTUBE_RETRY_CLIENTS = (process.env.YTDLP_YOUTUBE_RETRY_CLIENTS?.trim() || "android")
  .split(";")
  .map((c) => c.trim())
  .filter(Boolean);

async function runYtdlp(args: string[]): Promise<Awaited<ReturnType<typeof runProcess>>> {
  const configured = process.env.YTDLP_PATH?.trim();
  const attempts: Array<[string, string[]]> = configured
    ? [[configured, args]]
    : [
        ["yt-dlp", args],
        ["python", ["-m", "yt_dlp", ...args]],
      ];
  for (const [cmd, cmdArgs] of attempts) {
    try {
      return await runProcess(cmd, cmdArgs, YTDLP_TIMEOUT_MS);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new ServiceError("PRECONDITION_FAILED", "Link downloads need yt-dlp installed on the server (or set YTDLP_PATH).");
}

async function clearPartialDownloads(dir: string) {
  const files = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => f.startsWith("source.")).map((f) => rm(path.join(dir, f), { force: true })));
}

async function downloadWithYtdlp(job: DubJob, dir: string, url: string) {
  const baseArgs = [
    "--no-playlist",
    "--match-filter",
    `duration <=? ${MAX_DUB_SECONDS}`,
    "--no-warnings",
    "--max-filesize",
    `${MAX_DUB_VIDEO_BYTES}`,
    "-f",
    "bv*[height<=720]+ba/b[height<=720]/b",
    "--merge-output-format",
    "mp4",
    "--print",
    "after_move:title",
    "--retries",
    "3",
    "-o",
    path.join(dir, "source.%(ext)s"),
  ];

  let result = await runYtdlp([...baseArgs, "--", url]);
  if (job.sourceKind === "youtube") {
    for (const clients of YOUTUBE_RETRY_CLIENTS) {
      if (result.code === 0 || !/HTTP Error 403/i.test(result.stderr)) break;
      logger.info("dub.ytdlp_retry", { jobId: job.id, clients });
      await clearPartialDownloads(dir);
      result = await runYtdlp([...baseArgs, "--extractor-args", `youtube:player_client=${clients}`, "--", url]);
    }
  }
  if (result.code !== 0) {
    logger.warn("dub.ytdlp_failed", { jobId: job.id, stderr: result.stderr.slice(-500) });
    const tooBig = /larger than max-filesize|File is larger/i.test(result.stderr);
    throw new ServiceError(
      "BAD_REQUEST",
      tooBig ? "Videos can be up to 200 MB." : "Could not download that link. It may be private, age-restricted or unsupported.",
    );
  }

  const files = await readdir(dir);
  const sourceFile = files.find((f) => f.startsWith("source.") && !f.endsWith(".part"));
  if (!sourceFile) {
    throw new ServiceError("BAD_REQUEST", `Nothing was downloaded. The video may be longer than ${MAX_DUB_SECONDS / 60} minutes.`);
  }
  const filePath = path.join(dir, sourceFile);
  job.filePath = filePath;
  job.sizeBytes = (await stat(filePath)).size;
  job.mimeType = mimeForExt(path.extname(sourceFile).toLowerCase());
  const title = result.stdout.trim().split("\n").pop()?.trim();
  if (title) job.title = title.slice(0, 200);
}

setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (now - job.createdAt > JOB_TTL_MS) void deleteJob(job.userId, job.id);
  }
}, 10 * 60 * 1000).unref();
