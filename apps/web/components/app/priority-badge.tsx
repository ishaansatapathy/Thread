"use client";

import { categoryLabel, urgencyDisplay } from "~/lib/priority-display";
import type { InboxPriorityCategory, InboxUrgency } from "@repo/services/ai/inbox-priority";

type Props = {
  urgency: InboxUrgency;
  score: number;
  reason?: string;
  category?: InboxPriorityCategory;
  rank?: number;
  compact?: boolean;
};

export function PriorityBadge({ urgency, reason, category, rank, compact }: Props) {
  const display = urgencyDisplay(urgency);

  return (
    <span className="thread-priority-badge-wrap" title={reason}>
      {rank != null ? <span className="thread-priority-rank">#{rank}</span> : null}
      <span
        className="thread-priority-badge"
        data-tone={display.tone}
        style={{
          color: display.color,
          background: display.bg,
          borderColor: display.border,
        }}
      >
        {display.shortLabel}
      </span>
      {!compact && category ? (
        <span className="thread-priority-category">{categoryLabel(category)}</span>
      ) : null}
    </span>
  );
}

export function PriorityReason({ reason }: { reason: string }) {
  return <p className="thread-priority-reason">{reason}</p>;
}
