/**
 * Optional lip-sync step: runs a local MuseTalk v1.5 install (needs an NVIDIA GPU) through its
 * `thread_lipsync.py` CLI. Enabled only when MUSETALK_PYTHON and MUSETALK_SCRIPT point at it.
 */
import { existsSync } from "node:fs";

import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";

import { runProcess } from "./dub-media";

const LIPSYNC_TIMEOUT_MS = 90 * 60 * 1000;

function paths() {
  const python = process.env.MUSETALK_PYTHON?.trim();
  const script = process.env.MUSETALK_SCRIPT?.trim();
  return python && script ? { python, script } : null;
}

export function isLipsyncConfigured(): boolean {
  const p = paths();
  return Boolean(p && existsSync(p.python) && existsSync(p.script));
}

// One GPU: lip-sync jobs run one at a time.
let queue: Promise<unknown> = Promise.resolve();

export function lipsync(video: string, audioWav: string, out: string): Promise<void> {
  const run = queue.then(async () => {
    const p = paths();
    if (!p || !isLipsyncConfigured()) throw new ServiceError("PRECONDITION_FAILED", "Lip-sync isn't set up on this server.");
    const result = await runProcess(p.python, [p.script, "--video", video, "--audio", audioWav, "--out", out], LIPSYNC_TIMEOUT_MS);
    if (result.code === 0) return;
    logger.warn("dub.lipsync_failed", { code: result.code, stderr: result.stderr.slice(-600) });
    if (result.code === 3) throw new ServiceError("BAD_REQUEST", "Lip-sync skipped: no face was found in the video.");
    if (result.code === null) throw new ServiceError("INTERNAL", "Lip-sync timed out.");
    throw new ServiceError("INTERNAL", "Lip-sync failed.");
  });
  queue = run.catch(() => undefined);
  return run;
}
