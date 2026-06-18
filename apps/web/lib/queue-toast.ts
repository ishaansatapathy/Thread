type QueueToastItem = {
  status: string;
  kind: string;
};

export function queueResultMessage(item: QueueToastItem): { title: string; queued: boolean } {
  const approved = item.status === "approved";

  if (item.kind === "email_send") {
    return approved
      ? { title: "Email sent via Gmail", queued: false }
      : { title: "Added to approval queue", queued: true };
  }

  if (item.kind === "email_draft") {
    return approved
      ? { title: "Draft saved to Gmail", queued: false }
      : { title: "Draft queued for review", queued: true };
  }

  if (item.kind === "draft_send") {
    return approved
      ? { title: "Draft sent via Gmail", queued: false }
      : { title: "Draft send queued — approve in Queue", queued: true };
  }

  if (item.kind === "calendar_invite") {
    return approved
      ? { title: "Calendar invite sent", queued: false }
      : { title: "Invite queued — approve in Queue", queued: true };
  }

  if (item.kind === "meeting_bundle") {
    return approved
      ? { title: "Meeting invite and email sent", queued: false }
      : { title: "Meeting queued — approve in Queue", queued: true };
  }

  if (item.kind === "calendar_archive") {
    return approved
      ? { title: "Event rescheduled on Calendar", queued: false }
      : { title: "Reschedule queued — confirm in Queue", queued: true };
  }

  if (item.kind === "calendar_delete") {
    return approved
      ? { title: "Event removed from Calendar", queued: false }
      : { title: "Delete queued — approve in Queue", queued: true };
  }

  if (item.kind === "calendar_update") {
    return approved
      ? { title: "Event details updated on Calendar", queued: false }
      : { title: "Event update queued — approve in Queue", queued: true };
  }

  return approved
    ? { title: "Action completed", queued: false }
    : { title: "Added to approval queue", queued: true };
}
