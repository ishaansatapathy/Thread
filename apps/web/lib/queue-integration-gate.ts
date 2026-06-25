export const GMAIL_QUEUE_KINDS = new Set([
  "email_send",
  "email_draft",
  "draft_send",
]);

export const CALENDAR_QUEUE_KINDS = new Set([
  "calendar_invite",
  "meeting_bundle",
  "calendar_archive",
  "calendar_delete",
  "calendar_update",
]);

export type IntegrationRequirement = "gmail" | "calendar";

export function getQueueIntegrationRequirement(
  kind: string,
  opts: {
    isDemoUser: boolean;
    gmailConnected: boolean;
    calendarConnected: boolean;
  },
): IntegrationRequirement | null {
  if (GMAIL_QUEUE_KINDS.has(kind)) {
    if (opts.gmailConnected) return null;
    // Demo queue still simulates email send on the server when Gmail is off.
    if (opts.isDemoUser) return null;
    return "gmail";
  }

  if (CALENDAR_QUEUE_KINDS.has(kind)) {
    if (opts.calendarConnected) return null;
    return "calendar";
  }

  return null;
}

export function integrationRequirementFromError(message: string): IntegrationRequirement | null {
  const lower = message.toLowerCase();
  if (
    lower.includes("gmail") &&
    (lower.includes("not connected") || lower.includes("connect gmail"))
  ) {
    return "gmail";
  }
  if (
    lower.includes("calendar") &&
    (lower.includes("not connected") || lower.includes("connect") || lower.includes("google calendar"))
  ) {
    return "calendar";
  }
  return null;
}
