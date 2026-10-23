/**
 * Advances meetings sitting in "processing": polls their Gnani job, and on
 * completion fetches the transcript and runs the AI notes pass.
 */
import { logger } from "@repo/logger";
import { acquireLeaderLock } from "@repo/services/cache/leader-lock";

import { isGnaniConfigured } from "../services/gnani";
import { pollProcessingMeetings } from "../services/meetings";

const POLL_INTERVAL_MS = 15_000;
const INITIAL_DELAY_MS = 10_000;
const LEADER_LOCK_TTL_MS = 60_000;
const LEADER_LOCK_NAME = "meeting-transcription-poll";

export function startMeetingTranscriptionJob() {
  if (process.env.VITEST === "true") return;
  if (!isGnaniConfigured()) {
    logger.warn("meeting-transcription: GNANI_API_KEY is not set — live transcription and recording uploads are disabled");
    return;
  }

  const tick = () => {
    void (async () => {
      const isLeader = await acquireLeaderLock(LEADER_LOCK_NAME, LEADER_LOCK_TTL_MS);
      if (!isLeader) return;
      await pollProcessingMeetings();
    })().catch((error: unknown) => {
      logger.warn("meeting-transcription: poll error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };

  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, POLL_INTERVAL_MS);
  logger.info("meeting-transcription: polling scheduled", { intervalMs: POLL_INTERVAL_MS });
}
