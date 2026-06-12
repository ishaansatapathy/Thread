export function parseReplyTo(from?: string) {
  if (!from) return "";
  const bracket = from.match(/<([^>]+)>/);
  if (bracket?.[1]) return bracket[1];
  const plain = from.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  return plain?.[0] ?? from;
}

export function replySubject(subject?: string) {
  const trimmed = subject?.trim() || "No subject";
  let base = trimmed;
  while (/^(re|fwd):\s*/i.test(base)) {
    base = base.replace(/^(re|fwd):\s*/i, "").trim();
  }
  return `Re: ${base || "No subject"}`;
}

export function displaySender(from?: string) {
  if (!from) return "Unknown";
  const nameMatch = from.match(/^([^<]+)</);
  if (nameMatch?.[1]) {
    return nameMatch[1].trim().replace(/^"|"$/g, "");
  }
  return parseReplyTo(from);
}

export function formatMessageDate(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact date for dense inbox rows: time today, weekday this week, else date. */
export function formatListDate(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const now = new Date();
  const sameDay =
    parsed.getDate() === now.getDate() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getFullYear() === now.getFullYear();
  if (sameDay) {
    return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
  if (now.getTime() - parsed.getTime() < sixDaysMs) {
    return parsed.toLocaleDateString(undefined, { weekday: "short" });
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Subject line for list rows — skips placeholder values from older cache rows. */
export function listThreadSubject(subject?: string, snippet?: string) {
  const trimmed = subject?.trim();
  if (trimmed && trimmed !== "No subject") return trimmed;
  return snippet?.trim() || "No subject";
}

export function replyTargetForMessage(
  message: { from?: string; to?: string },
  userEmail?: string,
) {
  const from = parseReplyTo(message.from);
  const me = userEmail?.trim().toLowerCase();
  if (from && me && from.toLowerCase() === me) {
    return parseReplyTo(message.to) || from;
  }
  return from;
}

export function sortThreadsByRank<T extends { id: string }>(threads: T[], rankedIds: string[]) {
  const order = new Map(rankedIds.map((id, index) => [id, index]));
  return [...threads].sort((left, right) => {
    const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}
