export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteDoc {
  path: string;
  method: HttpMethod;
  summary: string;
  description: string;
}

function r(
  path: string,
  method: HttpMethod,
  summary: string,
  description: string,
): RouteDoc {
  return { path, method, summary, description };
}

/** Every tRPC OpenAPI route — applied programmatically in enrichThreadOpenApi */
export const ROUTE_CATALOG: RouteDoc[] = [
  // ── Authentication ───────────────────────────────────────────────────────
  r(
    "/authentication/supported-providers",
    "get",
    "List supported auth providers",
    "Returns enabled sign-in methods (email/password, OAuth). Used by the login page to render provider buttons.",
  ),
  r(
    "/authentication/sign-up",
    "post",
    "Create a new account",
    "Registers user with email/password. Requires Cloudflare Turnstile token. Sends verification email. **UI:** `/sign-up`.",
  ),
  r(
    "/authentication/sign-in",
    "post",
    "Sign in (sets JWT cookies)",
    "Authenticates user and sets httpOnly `jwt` + `jwt_refresh` cookies. Returns user profile or 2FA challenge. **MCP tool:** N/A — use cookies or `THREAD_MCP_API_KEY` for headless.",
  ),
  r(
    "/authentication/demo-sign-in",
    "post",
    "Demo sign-in (no Turnstile)",
    "Signs in the seeded demo user when DEMO_LOGIN_ENABLED=true. Used by web `/api-auth/demo`.",
  ),
  r(
    "/authentication/verify-2fa",
    "post",
    "Complete two-factor authentication",
    "Second step after sign-in when 2FA enabled. Sets JWT cookies on success.",
  ),
  r(
    "/authentication/logout",
    "post",
    "Sign out",
    "Clears JWT cookies. **UI:** Settings → Sign out.",
  ),
  r(
    "/authentication/refresh",
    "post",
    "Refresh access token",
    "Uses `jwt_refresh` cookie to issue new access token without re-login.",
  ),
  r(
    "/authentication/me",
    "get",
    "Get current user",
    "Returns authenticated user profile, email verification status, 2FA state. **UI:** used app-wide for session.",
  ),
  r(
    "/authentication/forgot-password",
    "post",
    "Request password reset OTP",
    "Sends OTP email for password recovery flow.",
  ),
  r(
    "/authentication/verify-otp",
    "post",
    "Verify password-reset OTP",
    "Validates OTP before allowing password change.",
  ),
  r(
    "/authentication/reset-password",
    "post",
    "Reset password with OTP",
    "Sets new password after OTP verification.",
  ),
  r(
    "/authentication/verify-email",
    "post",
    "Verify email address",
    "Confirms email via token from verification link.",
  ),
  r(
    "/authentication/send-verification-email-again",
    "post",
    "Resend verification email (public)",
    "Resends verification link to unverified email.",
  ),
  r(
    "/authentication/send-verification-again",
    "post",
    "Resend verification email (authenticated)",
    "Authenticated resend for logged-in unverified users.",
  ),
  r(
    "/authentication/toggle-2fa",
    "post",
    "Enable or disable 2FA",
    "Toggles TOTP two-factor auth. **UI:** Settings → Security.",
  ),
  r(
    "/authentication/setup-profile",
    "post",
    "Complete profile setup",
    "Post sign-up profile completion (name, avatar). **UI:** onboarding flow.",
  ),

  // ── Inbox (Corsair Gmail) ─────────────────────────────────────────────────
  r(
    "/inbox/connection-status",
    "get",
    "Gmail connection status",
    "Returns whether Corsair Gmail OAuth is connected for tenant. **Corsair:** tenant plugin status. **MCP:** `get_gmail_connection_status`. **UI:** Settings.",
  ),
  r(
    "/inbox/threads",
    "get",
    "List Gmail inbox threads",
    "Live Corsair Gmail `threads.list` with pagination (`pageToken`), Gmail search `query`, `maxResults`. **MCP:** `list_inbox`, `search_inbox`. **UI:** `/inbox`.",
  ),
  r(
    "/inbox/threads/cached",
    "get",
    "List threads (cache-first)",
    "Returns cached threads when fresh; falls back to live Corsair sync. Faster initial inbox load.",
  ),
  r(
    "/inbox/threads/{threadId}",
    "get",
    "Get full Gmail thread",
    "Corsair Gmail `threads.get` — all messages, bodies, participants. **MCP:** `get_thread`. **UI:** thread detail pane.",
  ),
  r(
    "/inbox/drafts",
    "get",
    "List Gmail drafts",
    "Corsair Gmail `drafts.list`. **MCP:** `list_drafts`. **UI:** `/inbox` drafts tab.",
  ),
  r(
    "/inbox/drafts/{draftId}",
    "get",
    "Get a single draft",
    "Corsair Gmail `drafts.get`. **MCP:** `get_draft`.",
  ),
  r(
    "/inbox/send",
    "post",
    "Send email immediately",
    "Direct Corsair `messages.send`. Prefer `/queue/enqueue/email` for HITL. Supports to/cc/bcc/attachments.",
  ),
  r(
    "/inbox/drafts",
    "post",
    "Create Gmail draft",
    "Corsair `drafts.create`. **MCP:** `create_draft_email`. Prefer queue for agent-created drafts.",
  ),
  r(
    "/inbox/drafts/{draftId}",
    "put",
    "Update Gmail draft",
    "Corsair `drafts.update`. **MCP:** `update_draft`.",
  ),
  r(
    "/inbox/drafts/{draftId}/send",
    "post",
    "Send draft immediately",
    "Direct Corsair `drafts.send`. Prefer `/queue/enqueue/draft-send` for approval. **MCP:** `send_draft`.",
  ),
  r(
    "/inbox/drafts/{draftId}",
    "delete",
    "Delete Gmail draft",
    "Corsair `drafts.delete`. **MCP:** `delete_draft`.",
  ),
  r(
    "/inbox/threads/{threadId}/read",
    "post",
    "Mark thread read",
    "Corsair `threads.modify` — remove UNREAD. **MCP:** `mark_thread_read`.",
  ),
  r(
    "/inbox/threads/{threadId}/unread",
    "post",
    "Mark thread unread",
    "Corsair `threads.modify` — add UNREAD. **MCP:** `mark_thread_unread`.",
  ),
  r(
    "/inbox/threads/{threadId}/archive",
    "post",
    "Archive thread",
    "Corsair `threads.modify` — remove INBOX. **MCP:** `archive_thread`.",
  ),
  r(
    "/inbox/threads/{threadId}/star",
    "post",
    "Star thread",
    "Corsair `threads.modify` — add STARRED. **MCP:** `star_thread`.",
  ),
  r(
    "/inbox/threads/{threadId}/star",
    "delete",
    "Unstar thread",
    "Corsair `threads.modify` — remove STARRED. **MCP:** `unstar_thread`.",
  ),
  r(
    "/inbox/threads/{threadId}/important",
    "post",
    "Mark thread important",
    "Corsair `threads.modify` — add IMPORTANT. **MCP:** `mark_important`.",
  ),
  r(
    "/inbox/threads/{threadId}/important",
    "delete",
    "Remove important flag",
    "Corsair `threads.modify` — remove IMPORTANT. **MCP:** `mark_not_important`.",
  ),
  r(
    "/inbox/threads/{threadId}/trash",
    "post",
    "Move thread to trash",
    "Corsair `threads.trash`. **MCP:** `trash_thread`.",
  ),
  r(
    "/inbox/threads/{threadId}/untrash",
    "post",
    "Restore thread from trash",
    "Corsair `threads.untrash`. **MCP:** `untrash_thread`.",
  ),
  r(
    "/inbox/threads/{threadId}",
    "delete",
    "Permanently delete thread",
    "Corsair `threads.delete`. **MCP:** `delete_thread`.",
  ),
  r(
    "/inbox/threads/{threadId}/mute",
    "post",
    "Mute thread notifications",
    "Corsair mute via label modify. **MCP:** `mute_thread`.",
  ),
  r(
    "/inbox/threads/{threadId}/unmute",
    "post",
    "Unmute thread",
    "Removes mute label. **MCP:** `unmute_thread`.",
  ),
  r(
    "/inbox/labels",
    "get",
    "List Gmail labels",
    "Corsair `users.labels.list`. **MCP:** `list_labels`.",
  ),
  r(
    "/inbox/labels/{labelId}",
    "get",
    "Get label details",
    "Corsair label metadata by ID.",
  ),
  r(
    "/inbox/labels/{labelId}",
    "patch",
    "Update user label",
    "Corsair label update (name, visibility).",
  ),
  r(
    "/inbox/labels/{labelId}",
    "delete",
    "Delete user label",
    "Corsair label delete.",
  ),
  r(
    "/inbox/threads/{threadId}/labels",
    "post",
    "Apply labels to thread",
    "Corsair `threads.modify` add labels. **MCP:** `apply_label`.",
  ),
  r(
    "/inbox/threads/{threadId}/labels/{labelId}",
    "delete",
    "Remove label from thread",
    "Corsair `threads.modify` remove label. **MCP:** `remove_label`.",
  ),
  r(
    "/inbox/messages",
    "get",
    "List messages",
    "Corsair `messages.list` with optional query. **MCP:** `list_messages`.",
  ),
  r(
    "/inbox/messages/{messageId}/labels",
    "post",
    "Apply labels to message",
    "Corsair `messages.modify`. **MCP:** `modify_message`.",
  ),
  r(
    "/inbox/messages/batch-modify",
    "post",
    "Batch modify messages",
    "Corsair `messages.batchModify` — bulk label changes.",
  ),
  r(
    "/inbox/threads/batch-modify",
    "post",
    "Batch modify threads",
    "Corsair `threads.batchModify`. **MCP:** `batch_modify_threads`.",
  ),
  r(
    "/inbox/messages/{messageId}/trash",
    "post",
    "Trash a message",
    "Corsair `messages.trash`.",
  ),
  r(
    "/inbox/messages/{messageId}/untrash",
    "post",
    "Untrash a message",
    "Corsair `messages.untrash`.",
  ),
  r(
    "/inbox/messages/{messageId}",
    "delete",
    "Permanently delete message",
    "Corsair `messages.delete`.",
  ),
  r(
    "/inbox/db/threads/search",
    "get",
    "Search synced threads (Corsair DB)",
    "Fast local search via `corsair.gmail.db.threads.search`. **MCP:** `search_threads_db`. No Gmail quota.",
  ),
  r(
    "/inbox/db/messages/search",
    "get",
    "Search synced messages (Corsair DB)",
    "Search bodies/snippets in Corsair Postgres cache. **MCP:** `search_messages_db`.",
  ),
  r(
    "/inbox/db/drafts/search",
    "get",
    "Search synced drafts (Corsair DB)",
    "Draft index search. **MCP:** `search_drafts_db`.",
  ),
  r(
    "/inbox/db/labels/search",
    "get",
    "Search synced labels (Corsair DB)",
    "Filter labels by name. **MCP:** `search_labels_db`.",
  ),
  r(
    "/inbox/disconnect",
    "post",
    "Disconnect Gmail",
    "Revokes Corsair Gmail OAuth for tenant. **UI:** Settings.",
  ),

  // ── Calendar (Corsair Google Calendar) ────────────────────────────────────
  r(
    "/calendar/connection-status",
    "get",
    "Calendar connection status",
    "Corsair Calendar plugin connected state. **MCP:** `get_calendar_connection_status`. **UI:** Settings.",
  ),
  r(
    "/calendar/events",
    "get",
    "List calendar events",
    "Corsair `events.list` for `timeMin`/`timeMax`. **MCP:** `list_calendar_events`. **UI:** `/calendar` Day/Week/Month.",
  ),
  r(
    "/calendar/events/{eventId}",
    "get",
    "Get calendar event",
    "Corsair `events.get`. **MCP:** `get_calendar_event`.",
  ),
  r(
    "/calendar/events",
    "post",
    "Create event (direct)",
    "Direct Corsair `events.create`. Prefer `/queue/enqueue/calendar` for HITL. Supports attendees, RRULE, Meet link.",
  ),
  r(
    "/calendar/events/quick-add",
    "post",
    "Quick-add event (queued)",
    "NLP parser → queue item (`calendar_invite`). **MCP:** `quick_add_event`. **UI:** calendar quick-add bar.",
  ),
  r(
    "/calendar/events/{eventId}/reschedule",
    "patch",
    "Reschedule event",
    "Corsair `events.patch` (start/end). Queued via `/queue/enqueue/calendar-archive` for HITL. **MCP:** `reschedule_event`.",
  ),
  r(
    "/calendar/events/{eventId}/details",
    "patch",
    "Update event metadata",
    "Corsair `events.patch` (title, description, location). **MCP:** `update_event_details`.",
  ),
  r(
    "/calendar/events/{eventId}/rsvp",
    "post",
    "RSVP to event invite",
    "Corsair `events.patch` attendee response (`accepted`/`declined`/`tentative`). **MCP:** `respond_to_event`.",
  ),
  r(
    "/calendar/events/{eventId}/cancel",
    "post",
    "Cancel event",
    "Corsair `events.patch` status cancelled. **MCP:** `cancel_event`.",
  ),
  r(
    "/calendar/events/{eventId}",
    "delete",
    "Delete event",
    "Corsair `events.delete`. Queued via `/queue/enqueue/calendar-delete`.",
  ),
  r(
    "/calendar/free-busy",
    "post",
    "Query free/busy",
    "Corsair `freebusy.query` for scheduling. **MCP:** `check_free_busy`.",
  ),
  r(
    "/calendar/db/events/search",
    "get",
    "Search synced events (Corsair DB)",
    "Fast event search. **MCP:** `search_events_db`.",
  ),
  r(
    "/calendar/db/calendars/search",
    "get",
    "Search synced calendars (Corsair DB)",
    "Calendar list search. **MCP:** `search_calendars_db`.",
  ),
  r(
    "/calendar/disconnect",
    "post",
    "Disconnect Calendar",
    "Revokes Corsair Calendar OAuth. **UI:** Settings.",
  ),

  // ── Queue (Human-in-the-loop) ─────────────────────────────────────────────
  r(
    "/queue/pending-count",
    "get",
    "Count pending queue items",
    "Badge count for nav. **UI:** queue notification badge.",
  ),
  r(
    "/queue/items",
    "get",
    "List queue items",
    "Filter by status/kind. Pending items show as dashed calendar blocks. **MCP:** `list_queue`. **UI:** `/queue`.",
  ),
  r(
    "/queue/stats",
    "get",
    "Queue statistics",
    "Counts by status and kind for dashboard.",
  ),
  r(
    "/queue/enqueue/email",
    "post",
    "Queue email send or draft",
    "Creates `email_send` or `email_draft`. Approve → Corsair send/drafts.create. Dedupes within 10 min. **MCP:** `queue_email`.",
  ),
  r(
    "/queue/enqueue/calendar",
    "post",
    "Queue calendar invite",
    "Creates `calendar_invite`. Approve → Corsair `events.create`. **MCP:** `queue_calendar_invite`.",
  ),
  r(
    "/queue/enqueue/meeting",
    "post",
    "Queue meeting bundle",
    "Creates `meeting_bundle` — calendar invite + email in one approval. **UI:** agent meeting scheduling.",
  ),
  r(
    "/queue/enqueue/calendar-archive",
    "post",
    "Queue event reschedule",
    "Creates `calendar_archive` — reschedule with amber overlay until approved.",
  ),
  r(
    "/queue/enqueue/calendar-delete",
    "post",
    "Queue event deletion",
    "Creates `calendar_delete` — delete overlay until approved.",
  ),
  r(
    "/queue/enqueue/quick-add",
    "post",
    "Queue quick-add event",
    "NLP text → `calendar_invite` queue item. Same as `/calendar/events/quick-add`.",
  ),
  r(
    "/queue/enqueue/draft-send",
    "post",
    "Queue draft send",
    "Creates `draft_send`. Approve → Corsair `drafts.send`. **UI:** inbox Send on draft.",
  ),
  r(
    "/queue/approve",
    "post",
    "Approve queue item",
    "Executes Corsair side effect: send, create event, etc. Idempotent. **MCP:** `approve_queue_item`.",
  ),
  r(
    "/queue/dismiss",
    "post",
    "Dismiss queue item",
    "Cancel without Corsair action. **MCP:** `dismiss_queue_item`.",
  ),

  // ── Agent ─────────────────────────────────────────────────────────────────
  r(
    "/agent/status",
    "get",
    "Agent availability",
    "Returns whether OpenAI + Corsair are configured for agent chat.",
  ),
  r(
    "/agent/chat",
    "post",
    "Agent chat (blocking)",
    "OpenAI tool loop with **57 Corsair tools**. Returns reply, action cards, tool memory. Streaming: `POST /agent/stream`. **UI:** `/agent`.",
  ),
  r(
    "/agent/sessions",
    "get",
    "List agent sessions",
    "Persistent chat sessions with focus thread/event. **UI:** agent sidebar.",
  ),
  r(
    "/agent/sessions",
    "post",
    "Create agent session",
    "New session with optional focus context (threadId, eventId).",
  ),
  r(
    "/agent/sessions/{id}",
    "get",
    "Get agent session",
    "Session metadata, focus, message count.",
  ),
  r(
    "/agent/sessions/{id}",
    "patch",
    "Update agent session",
    "Rename or change focus thread/event.",
  ),
  r(
    "/agent/sessions/{id}",
    "delete",
    "Delete agent session",
    "Removes session and turns from Postgres.",
  ),
  r(
    "/agent/sessions/{id}/turn",
    "post",
    "Add turn to session",
    "Append user/assistant message to session history.",
  ),
  r(
    "/agent/history",
    "get",
    "Get legacy agent history",
    "Flat history before sessions model.",
  ),
  r(
    "/agent/history",
    "post",
    "Save legacy agent history",
    "Persist flat history blob.",
  ),
  r(
    "/agent/history",
    "delete",
    "Clear legacy agent history",
    "Wipes flat history.",
  ),

  // ── AI ────────────────────────────────────────────────────────────────────
  r(
    "/ai/status",
    "get",
    "AI feature availability",
    "OpenAI key configured, Corsair connected flags.",
  ),
  r(
    "/ai/inbox/rank",
    "post",
    "AI inbox priority ranking",
    "Ranks threads by urgency via Corsair data + OpenAI. **MCP:** `rank_inbox`. **UI:** inbox priority sort.",
  ),
  r(
    "/ai/daily-brief",
    "get",
    "AI daily brief",
    "Corsair inbox + calendar + OpenAI synthesis. **MCP:** `get_daily_brief`.",
  ),
  r(
    "/ai/summarize-thread",
    "get",
    "Summarize Gmail thread",
    "OpenAI summary of thread via Corsair fetch. **MCP:** `summarize_thread`.",
  ),
  r(
    "/ai/contact-intel",
    "get",
    "Contact intelligence",
    "Relationship context from inbox history. **MCP:** `get_contact_intel`.",
  ),
  r(
    "/ai/meeting-slots",
    "post",
    "Find meeting slots",
    "Corsair free/busy + OpenAI slot suggestions. **MCP:** `find_meeting_slots`.",
  ),
  r(
    "/ai/brief-dismissals",
    "get",
    "List dismissed brief items",
    "User-dismissed brief attention items.",
  ),
  r(
    "/ai/brief-dismissals",
    "post",
    "Dismiss brief item",
    "Hide item from daily brief.",
  ),
  r(
    "/ai/brief-dismissals",
    "delete",
    "Clear brief dismissals",
    "Reset all dismissed items.",
  ),

  // ── Brief ─────────────────────────────────────────────────────────────────
  r(
    "/brief",
    "get",
    "Get daily brief (cached)",
    "Aggregated brief: greeting, meetings, attention items. Live Corsair Gmail + Calendar. **UI:** `/brief`.",
  ),
  r(
    "/brief/refresh",
    "post",
    "Force refresh daily brief",
    "Bypasses cache, re-fetches Corsair + OpenAI.",
  ),

  // ── Contacts ──────────────────────────────────────────────────────────────
  r(
    "/contacts/search",
    "get",
    "Search contacts",
    "Search local contact index by name/email.",
  ),
  r(
    "/contacts/upsert",
    "post",
    "Create or update contact",
    "Upsert contact record for relationship intel.",
  ),
  r(
    "/contacts/sync-inbox",
    "post",
    "Sync contacts from inbox",
    "Extract contacts from recent Corsair Gmail threads.",
  ),
  r(
    "/contacts/sync-inbox-batch",
    "post",
    "Batch sync contacts",
    "Paginated inbox contact extraction.",
  ),

  // ── Settings ──────────────────────────────────────────────────────────────
  r(
    "/settings/approval-defaults",
    "get",
    "Get auto-approve settings",
    "Per-origin defaults: agent email, inbox email, calendar invites. **UI:** Settings → Approvals.",
  ),
  r(
    "/settings/approval-defaults",
    "put",
    "Update auto-approve settings",
    "Enable/disable auto-approve per action origin.",
  ),

  // ── Health ────────────────────────────────────────────────────────────────
  r(
    "/health",
    "get",
    "Health check (liveness)",
    "Returns `{ ok: true }` when API process is alive. Used by load balancers.",
  ),
];

/** MCP tool manifest appendix for Scalar intro / DOCS.md */
export const MCP_TOOLS_BY_CATEGORY: Record<string, string[]> = {
  "Gmail read": [
    "list_inbox",
    "search_inbox",
    "get_thread",
    "list_messages",
    "list_drafts",
    "get_draft",
    "list_labels",
    "get_thread_context",
  ],
  "Gmail write": [
    "archive_thread",
    "star_thread",
    "unstar_thread",
    "mark_important",
    "mark_not_important",
    "mark_thread_read",
    "mark_thread_unread",
    "apply_label",
    "remove_label",
    "trash_thread",
    "untrash_thread",
    "delete_thread",
    "mute_thread",
    "unmute_thread",
    "modify_message",
    "batch_modify_threads",
    "create_draft_email",
    "update_draft",
    "send_draft",
    "delete_draft",
  ],
  Queue: ["queue_email", "list_queue", "approve_queue_item", "dismiss_queue_item"],
  Calendar: [
    "list_calendar_events",
    "get_calendar_event",
    "queue_calendar_invite",
    "quick_add_event",
    "reschedule_event",
    "update_event_details",
    "respond_to_event",
    "cancel_event",
    "check_free_busy",
    "find_meeting_slots",
  ],
  "Connection status": ["get_gmail_connection_status", "get_calendar_connection_status"],
  AI: [
    "rank_inbox",
    "get_daily_brief",
    "get_smart_replies",
    "get_meeting_prep",
    "get_missed_followups",
    "get_contact_intel",
    "summarize_thread",
  ],
  "Corsair DB search": [
    "search_threads_db",
    "search_messages_db",
    "search_events_db",
    "search_calendars_db",
    "search_drafts_db",
    "search_labels_db",
  ],
};

export function buildMcpToolsAppendix(): string {
  const lines = ["## MCP tools (57 total)", ""];
  for (const [category, tools] of Object.entries(MCP_TOOLS_BY_CATEGORY)) {
    lines.push(`### ${category} (${tools.length})`, "");
    for (const tool of tools) {
      lines.push(`- \`${tool}\``);
    }
    lines.push("");
  }
  lines.push(
    "**Official Corsair MCP** (`POST /mcp/corsair`): `corsair_setup`, `list_operations`, `get_schema`, `run_script`",
  );
  return lines.join("\n");
}
