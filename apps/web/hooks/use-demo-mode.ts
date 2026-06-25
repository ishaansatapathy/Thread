"use client";

import { useCallback, useState } from "react";
import { env } from "~/env";
import { isDemoLoginEnabled } from "~/lib/demo-config";

const DEFAULT_EMAIL = "demo@thread.dev";

export type DemoFeature = "agent" | "calendar" | "mail";

const DEFAULT_LIMITS: Record<DemoFeature, number> = {
  agent: 3,
  calendar: 3,
  mail: 3,
};

const FEATURE_LABELS: Record<DemoFeature, string> = {
  agent: "Agent",
  calendar: "Calendar",
  mail: "Inbox AI",
};

function getDemoEmail() {
  return env.NEXT_PUBLIC_DEMO_USER_EMAIL?.trim() || DEFAULT_EMAIL;
}

function getLimit(feature: DemoFeature): number {
  const envKey = {
    agent: env.NEXT_PUBLIC_DEMO_AGENT_LIMIT,
    calendar: env.NEXT_PUBLIC_DEMO_CALENDAR_LIMIT,
    mail: env.NEXT_PUBLIC_DEMO_MAIL_LIMIT,
  }[feature];
  return envKey ?? DEFAULT_LIMITS[feature];
}

function storageKey(feature: DemoFeature) {
  return `thread_demo_${feature}_attempts`;
}

function readAttempts(feature: DemoFeature): number {
  if (typeof window === "undefined") return 0;
  return Number(sessionStorage.getItem(storageKey(feature)) ?? "0");
}

function writeAttempts(feature: DemoFeature, count: number) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(storageKey(feature), String(count));
  }
}

export type DemoFeatureState = {
  feature: DemoFeature;
  label: string;
  attempts: number;
  limit: number;
  remaining: number;
  isExhausted: boolean;
};

export interface DemoModeState {
  isDemo: boolean;
  limits: Record<DemoFeature, DemoFeatureState>;
  canUseFeature: (feature: DemoFeature) => boolean;
  recordAttempt: (feature: DemoFeature) => boolean;
  getFeature: (feature: DemoFeature) => DemoFeatureState;
  resetAttempts: () => void;
}

function buildFeatureState(feature: DemoFeature, attempts: number): DemoFeatureState {
  const limit = getLimit(feature);
  const remaining = Math.max(0, limit - attempts);
  return {
    feature,
    label: FEATURE_LABELS[feature],
    attempts,
    limit,
    remaining,
    isExhausted: remaining === 0,
  };
}

/**
 * Demo mode — per-feature attempt limits (not time-based).
 * Agent: 3 · Calendar: 3 · Mail (Brief refresh, summarize, etc.): 3
 */
export function useDemoMode(email: string | null | undefined): DemoModeState {
  const isDemo =
    isDemoLoginEnabled() &&
    Boolean(email && email.trim().toLowerCase() === getDemoEmail().toLowerCase());

  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  const getFeature = useCallback(
    (feature: DemoFeature): DemoFeatureState => {
      void tick;
      return buildFeatureState(feature, isDemo ? readAttempts(feature) : 0);
    },
    [isDemo, tick],
  );

  const limits: Record<DemoFeature, DemoFeatureState> = {
    agent: getFeature("agent"),
    calendar: getFeature("calendar"),
    mail: getFeature("mail"),
  };

  const canUseFeature = useCallback(
    (feature: DemoFeature): boolean => {
      if (!isDemo) return true;
      return readAttempts(feature) < getLimit(feature);
    },
    [isDemo],
  );

  const recordAttempt = useCallback(
    (feature: DemoFeature): boolean => {
      if (!isDemo) return true;
      const current = readAttempts(feature);
      const limit = getLimit(feature);
      if (current >= limit) {
        bump();
        return false;
      }
      writeAttempts(feature, current + 1);
      bump();
      return true;
    },
    [isDemo],
  );

  const resetAttempts = useCallback(() => {
    for (const feature of Object.keys(DEFAULT_LIMITS) as DemoFeature[]) {
      writeAttempts(feature, 0);
    }
    bump();
  }, []);

  return {
    isDemo,
    limits,
    canUseFeature,
    recordAttempt,
    getFeature,
    resetAttempts,
  };
}

export { FEATURE_LABELS as DEMO_FEATURE_LABELS };
