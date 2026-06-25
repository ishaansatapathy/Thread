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
    color: "#fca5a5",
    bg: "rgba(248, 113, 113, 0.1)",
    border: "rgba(248, 113, 113, 0.22)",
  },
  high: {
    label: "High priority",
    shortLabel: "High",
    tone: "high",
    color: "#fcd34d",
    bg: "rgba(251, 191, 36, 0.1)",
    border: "rgba(251, 191, 36, 0.22)",
  },
  medium: {
    label: "Medium",
    shortLabel: "Medium",
    tone: "medium",
    color: "#a8b4c8",
    bg: "rgba(168, 174, 186, 0.08)",
    border: "rgba(168, 174, 186, 0.2)",
  },
  low: {
    label: "Low",
    shortLabel: "Low",
    tone: "low",
    color: "var(--thread-dim)",
    bg: "rgba(148, 163, 184, 0.06)",
    border: "rgba(148, 163, 184, 0.16)",
  },
  noise: {
    label: "Low relevance",
    shortLabel: "FYI",
    tone: "muted",
    color: "var(--thread-dim)",
    bg: "rgba(148, 163, 184, 0.05)",
    border: "rgba(148, 163, 184, 0.12)",
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
  medium?: number;
  low?: number;
  noise?: number;
  replyNeeded: number;
}): string {
  const parts: string[] = [];
  if (summary.critical > 0) parts.push(`${summary.critical} critical`);
  if (summary.high > 0) parts.push(`${summary.high} high priority`);
  if (summary.replyNeeded > 0) parts.push(`${summary.replyNeeded} need a reply`);

  const visible =
    (summary.critical ?? 0) +
    (summary.high ?? 0) +
    (summary.medium ?? 0) +
    (summary.low ?? 0);
  const hidden = summary.noise ?? 0;

  if (parts.length === 0) {
    if (visible > 0) {
      return `Nothing urgent · ${visible} worth a look${hidden > 0 ? ` · ${hidden} low-relevance hidden` : ""}`;
    }
    return `${summary.total} threads analyzed — inbox is clear.`;
  }

  if (hidden > 0) parts.push(`${hidden} low-relevance hidden`);
  return parts.join(" · ");
}
