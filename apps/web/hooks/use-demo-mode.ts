"use client";

import { useEffect, useRef, useState } from "react";
import { env } from "~/env";

const STORAGE_KEY = "thread_demo_start";
const WARNING_FLAG_KEY = "thread_demo_warned";
const DEFAULT_EMAIL = "demo@thread.dev";
const DEFAULT_MINUTES = 10;
// Show warning toast at this many minutes elapsed (8 min → 2 min left)
const WARNING_AT_ELAPSED_MIN = 8;

function getDemoEmail() {
  return env.NEXT_PUBLIC_DEMO_USER_EMAIL?.trim() || DEFAULT_EMAIL;
}

function getSessionMs() {
  const minutes = env.NEXT_PUBLIC_DEMO_SESSION_MINUTES ?? DEFAULT_MINUTES;
  return minutes * 60 * 1000;
}

function getWarningMs() {
  return WARNING_AT_ELAPSED_MIN * 60 * 1000;
}

function getDemoStart(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? Number(raw) : null;
}

function initDemoStart(): number {
  const existing = getDemoStart();
  if (existing) return existing;
  const now = Date.now();
  localStorage.setItem(STORAGE_KEY, String(now));
  return now;
}

export interface DemoModeState {
  /** True when the logged-in user is the demo account. */
  isDemo: boolean;
  /** Seconds remaining in the demo session (0 when expired). */
  secondsLeft: number;
  /** True once the 10-min window has elapsed. */
  isDemoExpired: boolean;
  /**
   * True once elapsed >= WARNING_AT_ELAPSED_MIN (8 min).
   * The consumer should fire a one-time warning toast when this becomes true.
   */
  shouldShowWarning: boolean;
  /** Mark warning as shown so it never fires again this session. */
  markWarningSeen: () => void;
  /** Wipe localStorage so the timer resets next time. */
  resetTimer: () => void;
}

/**
 * Detects whether the current user is the demo account and drives a
 * silent expiry timer backed by localStorage.
 *
 * Timer UX contract:
 *  - No visible countdown during normal usage
 *  - At 8 min elapsed → `shouldShowWarning` flips true (one-time toast)
 *  - At 10 min        → `isDemoExpired` flips true
 *  - When expired + user triggers an AI action → caller shows upgrade modal
 */
export function useDemoMode(email: string | null | undefined): DemoModeState {
  const isDemo = Boolean(email && email.trim() === getDemoEmail());

  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!isDemo || typeof window === "undefined") return 0;
    const start = getDemoStart() ?? Date.now();
    const elapsed = Date.now() - start;
    return Math.max(0, Math.ceil((getSessionMs() - elapsed) / 1000));
  });

  const [shouldShowWarning, setShouldShowWarning] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isDemo) return;

    const start = initDemoStart();

    const tick = () => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, Math.ceil((getSessionMs() - elapsed) / 1000));
      setSecondsLeft(remaining);

      // Fire one-time warning when elapsed >= 8 min
      const warned = sessionStorage.getItem(WARNING_FLAG_KEY) === "1";
      if (!warned && elapsed >= getWarningMs()) {
        setShouldShowWarning(true);
      }

      if (remaining === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    tick();
    intervalRef.current = setInterval(tick, 5000); // check every 5s is enough

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isDemo]);

  const markWarningSeen = () => {
    setShouldShowWarning(false);
    sessionStorage.setItem(WARNING_FLAG_KEY, "1");
  };

  const resetTimer = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(WARNING_FLAG_KEY);
    }
  };

  return {
    isDemo,
    secondsLeft,
    isDemoExpired: isDemo && secondsLeft === 0,
    shouldShowWarning,
    markWarningSeen,
    resetTimer,
  };
}

/** Format seconds as M:SS */
export function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
