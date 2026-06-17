import type { InboxPriorityCategory, InboxUrgency } from "@repo/services/ai/inbox-priority";

export type PriorityDisplay = {
  label: string;
  shortLabel: string;
  tone: "critical" | "high" | "medium" | "low" | "muted";
  color: string;
  bg: string;
  border: string;
};

const URGENCY_DISPLAY: Record<InboxUrgency, PriorityDisplay> = {
  critical: {
    label: "Critical",
    shortLabel: "Critical",
    tone: "critical",
    color: "#fecaca",
    bg: "rgba(239, 68, 68, 0.14)",
    border: "rgba(239, 68, 68, 0.35)",
  },
  high: {
    label: "High priority",
    shortLabel: "High",
    tone: "high",
    color: "#fdba74",
    bg: "rgba(249, 115, 22, 0.12)",
    border: "rgba(249, 115, 22, 0.32)",
  },
  medium: {
    label: "Medium",
    shortLabel: "Medium",
    tone: "medium",
    color: "#fde68a",
    bg: "rgba(234, 179, 8, 0.1)",
    border: "rgba(234, 179, 8, 0.28)",
  },
  low: {
    label: "Low",
    shortLabel: "Low",
    tone: "low",
    color: "var(--thread-dim)",
    bg: "rgba(148, 163, 184, 0.08)",
    border: "rgba(148, 163, 184, 0.22)",
  },
  noise: {
    label: "Low relevance",
    shortLabel: "FYI",
    tone: "muted",
    color: "var(--thread-dim)",
    bg: "rgba(148, 163, 184, 0.06)",
    border: "rgba(148, 163, 184, 0.16)",
  },
};

const CATEGORY_LABEL: Record<InboxPriorityCategory, string> = {
  reply_needed: "Reply needed",
  deadline: "Deadline",
  meeting: "Meeting",
  billing: "Billing",
  fyi: "FYI",
  promo: "Promotional",
};

export function urgencyDisplay(urgency: InboxUrgency): PriorityDisplay {
  return URGENCY_DISPLAY[urgency];
}

export function categoryLabel(category: InboxPriorityCategory): string {
  return CATEGORY_LABEL[category];
}

export function formatPrioritySummary(summary: {
  total: number;
  critical: number;
  high: number;
  replyNeeded: number;
}): string {
  const parts: string[] = [];
  if (summary.critical > 0) parts.push(`${summary.critical} critical`);
  if (summary.high > 0) parts.push(`${summary.high} high priority`);
  if (summary.replyNeeded > 0) parts.push(`${summary.replyNeeded} need a reply`);
  if (parts.length === 0) return `${summary.total} threads analyzed — nothing urgent right now.`;
  return parts.join(" · ");
}
