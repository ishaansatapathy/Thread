/**
 * Thread OpenAPI / Scalar enrichment — ChaiForm-style detailed judge docs.
 * Applied after trpc-to-openapi generation in server.ts.
 */

import { ROUTE_CATALOG, buildMcpToolsAppendix } from "./openapi-catalog";
import { buildThreadApiDescription } from "./openapi-intro";

type OpenApiMedia = {
  examples?: Record<string, { summary: string; description?: string; value: unknown }>;
};

type OpenApiOperation = {
  summary?: string;
  description?: string;
  tags?: string[];
  requestBody?: { content?: Record<string, OpenApiMedia> };
  parameters?: Array<{ name?: string; description?: string; example?: unknown; in?: string }>;
  responses?: Record<string, { description?: string }>;
  /** Scalar code samples */
  "x-codeSamples"?: Array<{ lang: string; label: string; source: string }>;
};

export type OpenApiDocumentWithPaths = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  tags?: Array<{ name: string; description?: string }>;
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
  /** Scalar sidebar grouping */
  "x-tagGroups"?: Array<{ name: string; tags: string[] }>;
};

function addJsonRequestExample(
  document: OpenApiDocumentWithPaths,
  path: string,
  method: "post" | "put" | "patch",
  key: string,
  summary: string,
  value: unknown,
  description?: string,
) {
  const operation = document.paths?.[path]?.[method];
  const json = operation?.requestBody?.content?.["application/json"];
  if (!json) return;
  json.examples = {
    ...json.examples,
    [key]: { summary, description, value },
  };
}

function setOperation(
  document: OpenApiDocumentWithPaths,
  path: string,
  method: string,
  patch: Partial<OpenApiOperation>,
) {
  const paths = document.paths ?? {};
  const op = paths[path]?.[method];
  if (!op) return;
  Object.assign(op, patch);
}

function addReferencePath(
  document: OpenApiDocumentWithPaths,
  path: string,
  method: string,
  operation: OpenApiOperation,
) {
  document.paths = document.paths ?? {};
  document.paths[path] = document.paths[path] ?? {};
  document.paths[path]![method] = operation;
}

function addCodeSample(
  document: OpenApiDocumentWithPaths,
  path: string,
  method: string,
  lang: string,
  label: string,
  source: string,
) {
  const op = document.paths?.[path]?.[method];
  if (!op) return;
  op["x-codeSamples"] = [...(op["x-codeSamples"] ?? []), { lang, label, source }];
}

function enrichQueryParams(
  document: OpenApiDocumentWithPaths,
  path: string,
  method: string,
  hints: Record<string, { description: string; example?: unknown }>,
) {
  const op = document.paths?.[path]?.[method];
  if (!op?.parameters) return;
  op.parameters = op.parameters.map((parameter) => {
    const name = parameter.name ?? "";
    const hint = hints[name];
    if (!hint) return parameter;
    return { ...parameter, description: hint.description, example: hint.example ?? parameter.example };
  });
}

export function enrichThreadOpenApi(
  document: OpenApiDocumentWithPaths,
  opts: { clientUrl: string; baseUrl: string },
): OpenApiDocumentWithPaths {
  const { clientUrl, baseUrl } = opts;

  document.info = {
    ...document.info,
    title: "Thread API — Corsair Gmail & Calendar",
    version: "2.5.0",
    description: [buildThreadApiDescription(clientUrl, baseUrl), "", "---", "", buildMcpToolsAppendix()].join("\n"),
  };

  document.servers = [
    { url: `${baseUrl}/api`, description: "Thread REST API (tRPC → OpenAPI)" },
    { url: baseUrl, description: "Thread root (MCP, webhooks, health, docs)" },
  ];

  document.tags = [
    {
      name: "Authentication",
      description: "Sign-up, sign-in, JWT cookies, 2FA, password reset, profile setup.",
    },
    {
      name: "Inbox",
      description:
        "**Corsair Gmail** — list/search threads, send, drafts, labels, star/archive/trash, batch modify, and **DB search** (`corsair.gmail.db.*`).",
    },
    {
      name: "Calendar",
      description:
        "**Corsair Google Calendar** — events CRUD, RSVP, free/busy, quick-add (queued), reschedule, and **DB search** (`googlecalendar.db.*`).",
    },
    {
      name: "Queue",
      description:
        "**Human-in-the-loop approval** — queue emails, drafts, calendar invites, meeting bundles, reschedule, delete. Approve executes Corsair side effects.",
    },
    {
      name: "Agent",
      description:
        "Blocking agent chat + **session CRUD** (focus thread/event, tool memory). Streaming variant: `POST /agent/stream` (SSE). 57 Corsair-backed tools.",
    },
    {
      name: "AI",
      description:
        "OpenAI-powered features: daily brief, inbox ranking, smart replies, meeting prep, contact intel, thread summarize, missed follow-ups.",
    },
    {
      name: "Brief",
      description: "Daily brief aggregation — live Corsair Gmail + Calendar + OpenAI synthesis.",
    },
    {
      name: "Contacts",
      description: "Contact search and inbox sync for relationship intelligence.",
    },
    {
      name: "Settings",
      description: "Auto-approve defaults per origin (agent vs inbox vs calendar).",
    },
    {
      name: "MCP & Webhooks",
      description: "Model Context Protocol (57 tools) + Gmail Pub/Sub + Calendar push notifications.",
    },
    {
      name: "Health",
      description: "Liveness and readiness probes for deployment.",
    },
  ];

  document["x-tagGroups"] = [
    { name: "Getting started", tags: ["Authentication", "Health"] },
    { name: "Corsair Gmail", tags: ["Inbox"] },
    { name: "Corsair Calendar", tags: ["Calendar"] },
    { name: "Approval queue", tags: ["Queue"] },
    { name: "AI & Agent", tags: ["AI", "Agent", "Brief"] },
    { name: "Platform", tags: ["Contacts", "Settings", "MCP & Webhooks"] },
  ];

  document.components = {
    ...document.components,
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "jwt",
        description:
          "JWT access token issued after POST /api/authentication/sign-in (httpOnly cookie). Required for all protected REST routes.",
      },
      mcpBearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "THREAD_MCP_API_KEY env var — must match THREAD_MCP_USER_ID. Used for /mcp and /mcp/corsair headless access.",
      },
    },
  };

  document.security = [{ cookieAuth: [] }];

  // ── Reference paths (not tRPC REST — documented for judges) ──────────────

  addReferencePath(document, "/mcp", "post", {
    tags: ["MCP & Webhooks"],
    summary: "Thread MCP server (JSON-RPC 2.0)",
    description: [
      "Full **MCP 2024-11-05** server with **57 domain tools**: inbox, queue, calendar, AI, Corsair DB search.",
      "",
      "**Public methods** (no auth): `initialize`, `tools/list`, `resources/list`, `prompts/list`",
      "",
      "**Protected methods**: `tools/call`, `resources/read`, `prompts/get` — session cookie or MCP bearer.",
      "",
      "See `mcp-server.json` in the repo for the complete tool manifest.",
      "",
      "### Example: tools/list",
      "",
      "```json",
      '{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }',
      "```",
      "",
      "### Example: tools/call (queue email)",
      "",
      "```json",
      '{ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "queue_email", "arguments": { "to": "a@b.com", "subject": "Hi", "body": "Hello" } } }',
      "```",
    ].join("\n"),
    responses: {
      "200": { description: "JSON-RPC 2.0 response" },
      "401": { description: "Authentication required for tools/call" },
    },
  });

  addReferencePath(document, "/mcp/corsair", "post", {
    tags: ["MCP & Webhooks"],
    summary: "Official Corsair MCP adapter (@corsair-dev/mcp)",
    description: [
      "Dynamic Corsair SDK access: `corsair_setup`, `list_operations`, `get_schema`, `run_script`.",
      "",
      "Requires the same auth as `/mcp`. Uses Corsair **Permissions** UI for destructive operations.",
    ].join("\n"),
    responses: { "200": { description: "JSON-RPC 2.0 response" } },
  });

  addReferencePath(document, "/webhooks/gmail", "post", {
    tags: ["MCP & Webhooks"],
    summary: "Gmail Pub/Sub webhook (Corsair)",
    description:
      "Google Pub/Sub push endpoint. Validates CORSAIR_WEBHOOK_SECRET, resolves tenant, runs incremental Gmail history sync via Corsair.",
    responses: { "200": { description: "Acknowledged" }, "503": { description: "Webhook secret not configured" } },
  });

  addReferencePath(document, "/webhooks/calendar", "post", {
    tags: ["MCP & Webhooks"],
    summary: "Google Calendar push notification webhook",
    description: "Calendar push channel callback — refreshes events for the tenant via Corsair.",
    responses: { "200": { description: "Acknowledged" } },
  });

  addReferencePath(document, "/agent/stream", "post", {
    tags: ["Agent"],
    summary: "Agent streaming chat (Server-Sent Events)",
    description: [
      "Streaming variant of `POST /api/agent/chat`. Returns SSE events: `status`, `token`, `complete`, `error`.",
      "",
      "Supports sessionId, focus thread/event, tool memory. Same 57 tools as MCP.",
    ].join("\n"),
    responses: { "200": { description: "text/event-stream" } },
  });

  addReferencePath(document, "/api-connect/gmail", "get", {
    tags: ["MCP & Webhooks"],
    summary: "Connect Gmail via Corsair OAuth",
    description: `Browser redirect flow. Implemented on Next.js at ${clientUrl}/api-connect/gmail. Completes Corsair OAuth and registers Gmail watch.`,
    responses: { "302": { description: "Redirect to Google consent or back to app" } },
  });

  addReferencePath(document, "/api-connect/calendar", "get", {
    tags: ["MCP & Webhooks"],
    summary: "Connect Google Calendar via Corsair OAuth",
    description: `Browser redirect at ${clientUrl}/api-connect/calendar. Registers Calendar push channel on success.`,
    responses: { "302": { description: "Redirect to Google consent or back to app" } },
  });

  addReferencePath(document, "/health", "get", {
    tags: ["Health"],
    summary: "Liveness probe",
    description: "Returns `{ ok: true }` when the API process is running. No auth required.",
    responses: { "200": { description: "Service alive" } },
  });

  addReferencePath(document, "/ready", "get", {
    tags: ["Health"],
    summary: "Readiness probe",
    description: "Checks database connectivity and Corsair configuration. Returns 503 if not ready.",
    responses: { "200": { description: "Ready to serve traffic" }, "503": { description: "Not ready" } },
  });

  addReferencePath(document, "/metrics", "get", {
    tags: ["Health"],
    summary: "Prometheus metrics",
    description: "Prometheus text format metrics (request counts, latencies). Requires docs auth in production.",
    responses: { "200": { description: "text/plain Prometheus metrics" } },
  });

  addReferencePath(document, "/sync/events", "get", {
    tags: ["MCP & Webhooks"],
    summary: "Real-time sync events (SSE)",
    description: [
      "Server-Sent Events stream for UI cache invalidation.",
      "",
      "Events: `gmail.sync`, `calendar.sync`, `queue.updated` — inbox/calendar pages auto-refresh.",
    ].join("\n"),
    responses: { "200": { description: "text/event-stream" } },
  });

  addReferencePath(document, "/webhooks/corsair", "post", {
    tags: ["MCP & Webhooks"],
    summary: "Corsair internal webhook",
    description: "Corsair plugin webhook hooks endpoint. Validates secret, routes to tenant handlers.",
    responses: { "200": { description: "Acknowledged" } },
  });

  addReferencePath(document, "/openapi.json", "get", {
    tags: ["Health"],
    summary: "OpenAPI 3.1 specification",
    description: "Machine-readable spec for this Scalar UI. Generated from tRPC OpenAPI + Thread enrichment.",
    responses: { "200": { description: "application/json OpenAPI document" } },
  });

  addReferencePath(document, "/api/corsair/{path}", "get", {
    tags: ["MCP & Webhooks"],
    summary: "Corsair SDK management API",
    description: [
      "Dynamic Corsair management routes via `corsair.toExpressHandler`.",
      "",
      "Includes connection status, backfill triggers, audit logs — see Corsair SDK docs.",
      "",
      "Base path: `/api/corsair/*` (also POST/PATCH/DELETE as supported by Corsair).",
    ].join("\n"),
    responses: { "200": { description: "Corsair management response" }, "503": { description: "Corsair not configured" } },
  });

  // ── Apply full route catalog (~116 endpoints) ──────────────────────────────

  for (const entry of ROUTE_CATALOG) {
    setOperation(document, entry.path, entry.method, {
      summary: entry.summary,
      description: entry.description,
    });
  }

  // ── Request examples ─────────────────────────────────────────────────────

  addJsonRequestExample(
    document,
    "/authentication/sign-in",
    "post",
    "demoSignIn",
    "Demo sign-in",
    { email: "demo@thread.dev", password: "DemoPass123!" },
    "Requires DEMO_LOGIN_ENABLED and seeded demo user.",
  );

  addJsonRequestExample(
    document,
    "/queue/enqueue/email",
    "post",
    "queueThankYou",
    "Queue a thank-you email",
    {
      mode: "send",
      email: {
        to: "friend@corsair.dev",
        subject: "Thanks for the sync",
        body: "Great chat today — I'll send the notes tomorrow.",
      },
      title: "Email to friend@corsair.dev",
    },
    "Returns pending item — approve via POST /queue/approve to send via Corsair Gmail.",
  );

  addJsonRequestExample(
    document,
    "/queue/enqueue/calendar",
    "post",
    "queueStandup",
    "Queue a standup invite",
    {
      calendar: {
        summary: "Team standup",
        description: "Daily sync",
        startDateTime: "2026-06-20T10:00:00",
        endDateTime: "2026-06-20T10:30:00",
        timeZone: "Asia/Kolkata",
        attendeeEmails: ["teammate@company.com"],
      },
      title: "Team standup",
    },
    "Creates dashed block on calendar until approved.",
  );

  addJsonRequestExample(
    document,
    "/queue/enqueue/quick-add",
    "post",
    "quickAddNatural",
    "Quick-add via natural language",
    { text: "Meeting with Sarah tomorrow 3pm for 1 hour" },
  );

  addJsonRequestExample(
    document,
    "/queue/approve",
    "post",
    "approveItem",
    "Approve a pending queue item",
    { id: "00000000-0000-4000-8000-000000000001" },
    "Use UUID from GET /queue/items.",
  );

  addJsonRequestExample(
    document,
    "/calendar/events/quick-add",
    "post",
    "calendarQuickAdd",
    "Quick-add (same as queue quick-add)",
    { text: "Lunch with Alex Friday noon" },
  );

  addJsonRequestExample(
    document,
    "/agent/chat",
    "post",
    "agentInboxQuery",
    "Ask agent about inbox",
    {
      message: "What's urgent in my inbox today? Star the top one.",
      history: [],
    },
  );

  addJsonRequestExample(
    document,
    "/agent/sessions",
    "post",
    "createSession",
    "Create agent session with focus",
    {
      title: "Follow up on Q3 proposal",
      focus: {
        threadId: "THREAD_ID_FROM_GMAIL",
        threadLabel: "Q3 proposal — Alex Chen",
      },
    },
  );

  addJsonRequestExample(
    document,
    "/calendar/free-busy",
    "post",
    "checkAvailability",
    "Check free/busy before scheduling",
    {
      startDateTime: "2026-06-20T14:00:00",
      endDateTime: "2026-06-20T15:00:00",
      timeZone: "Asia/Kolkata",
    },
  );

  addJsonRequestExample(
    document,
    "/calendar/events/{eventId}/rsvp",
    "post",
    "rsvpAccept",
    "Accept a meeting invite",
    { eventId: "abc123", response: "accepted" },
  );

  addJsonRequestExample(
    document,
    "/authentication/sign-up",
    "post",
    "signUp",
    "Create account",
    {
      email: "you@example.com",
      password: "SecurePass123!",
      confirmPassword: "SecurePass123!",
      turnstileToken: "TURNSTILE_TOKEN",
    },
  );

  addJsonRequestExample(
    document,
    "/queue/enqueue/draft-send",
    "post",
    "queueDraftSend",
    "Queue sending an existing draft",
    { draftId: "DRAFT_ID_FROM_GMAIL", title: "Send proposal draft" },
    "Approve via POST /queue/approve → Corsair drafts.send.",
  );

  addJsonRequestExample(
    document,
    "/queue/enqueue/meeting",
    "post",
    "queueMeetingBundle",
    "Queue meeting + email bundle",
    {
      calendar: {
        summary: "Product review",
        startDateTime: "2026-06-21T15:00:00",
        endDateTime: "2026-06-21T16:00:00",
        timeZone: "Asia/Kolkata",
        attendeeEmails: ["stakeholder@company.com"],
      },
      email: {
        to: "stakeholder@company.com",
        subject: "Product review — Friday 3pm",
        body: "Calendar invite attached. See you then!",
      },
      title: "Product review meeting bundle",
    },
  );

  addJsonRequestExample(
    document,
    "/queue/dismiss",
    "post",
    "dismissItem",
    "Dismiss a pending queue item",
    { id: "00000000-0000-4000-8000-000000000002" },
  );

  addJsonRequestExample(
    document,
    "/inbox/threads/batch-modify",
    "post",
    "batchArchive",
    "Batch archive threads",
    { threadIds: ["THREAD_ID_1", "THREAD_ID_2"], removeLabelIds: ["INBOX"] },
  );

  addJsonRequestExample(
    document,
    "/inbox/drafts",
    "post",
    "createDraft",
    "Create a Gmail draft",
    {
      to: "client@company.com",
      subject: "Follow-up on proposal",
      body: "Hi — following up on our conversation yesterday.",
    },
  );

  addJsonRequestExample(
    document,
    "/calendar/events",
    "post",
    "createEventDirect",
    "Create event directly (prefer queue)",
    {
      summary: "1:1 with mentor",
      startDateTime: "2026-06-22T11:00:00",
      endDateTime: "2026-06-22T11:30:00",
      timeZone: "Asia/Kolkata",
    },
  );

  addJsonRequestExample(
    document,
    "/ai/inbox/rank",
    "post",
    "rankInbox",
    "Rank inbox by urgency",
    { maxResults: 20, autoLabel: true },
  );

  addJsonRequestExample(
    document,
    "/contacts/upsert",
    "post",
    "upsertContact",
    "Save contact",
    { email: "alex@company.com", name: "Alex Chen", company: "Acme Corp" },
  );

  addJsonRequestExample(
    document,
    "/settings/approval-defaults",
    "put",
    "enableAutoApproveAgent",
    "Auto-approve agent emails",
    { agentEmail: true, inboxEmail: false, calendarInvites: false },
  );

  addJsonRequestExample(
    document,
    "/agent/sessions/{id}/turn",
    "post",
    "addTurn",
    "Append message to session",
    { role: "user", content: "Summarize this thread and draft a reply." },
  );

  // ── curl code samples (Scalar x-codeSamples) ─────────────────────────────

  addCodeSample(
    document,
    "/authentication/sign-in",
    "post",
    "curl",
    "Sign in (curl)",
    `curl -X POST '${baseUrl}/api/authentication/sign-in' \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"demo@thread.dev","password":"DemoPass123!","turnstileToken":""}' \\
  -c cookies.txt`,
  );

  addCodeSample(
    document,
    "/inbox/threads",
    "get",
    "curl",
    "List threads (cookie auth)",
    `curl '${baseUrl}/api/inbox/threads?maxResults=10&query=is:unread' \\
  -b cookies.txt`,
  );

  addCodeSample(
    document,
    "/queue/enqueue/email",
    "post",
    "curl",
    "Queue email (with CSRF)",
    `curl -X POST '${baseUrl}/api/queue/enqueue/email' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Thread-CSRF: 1' \\
  -H 'Origin: ${clientUrl}' \\
  -b cookies.txt \\
  -d '{"mode":"send","email":{"to":"a@b.com","subject":"Hi","body":"Hello"},"title":"Test"}'`,
  );

  addCodeSample(
    document,
    "/mcp",
    "post",
    "curl",
    "MCP tools/list",
    `curl -X POST '${baseUrl}/mcp' \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  );

  addCodeSample(
    document,
    "/mcp/corsair",
    "post",
    "curl",
    "Corsair list_operations",
    `curl -X POST '${baseUrl}/mcp/corsair' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_MCP_KEY' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_operations","arguments":{}}}'`,
  );

  // ── Query parameter documentation ────────────────────────────────────────

  enrichQueryParams(document, "/inbox/threads", "get", {
    maxResults: { description: "Page size (1–50)", example: 20 },
    query: { description: "Gmail search query (same syntax as Gmail)", example: "is:unread" },
    pageToken: { description: "Gmail pagination token from previous response" },
  });

  enrichQueryParams(document, "/calendar/events", "get", {
    timeMin: { description: "ISO 8601 range start", example: "2026-06-01T00:00:00Z" },
    timeMax: { description: "ISO 8601 range end", example: "2026-06-30T23:59:59Z" },
    calendarId: { description: "Calendar ID (default: primary)", example: "primary" },
  });

  enrichQueryParams(document, "/inbox/db/threads/search", "get", {
    q: { description: "Search query string", example: "proposal" },
    limit: { description: "Max results (default 20)", example: 20 },
  });

  enrichQueryParams(document, "/inbox/db/messages/search", "get", {
    q: { description: "Full-text search in message bodies", example: "invoice" },
    limit: { description: "Max results", example: 20 },
  });

  enrichQueryParams(document, "/calendar/db/events/search", "get", {
    q: { description: "Event title/description search", example: "standup" },
    limit: { description: "Max results", example: 20 },
  });

  enrichQueryParams(document, "/queue/items", "get", {
    status: { description: "Filter: pending | processing | approved | dismissed | failed", example: "pending" },
    kind: {
      description: "Filter: email_send | email_draft | draft_send | calendar_invite | meeting_bundle | calendar_archive | calendar_delete",
      example: "calendar_invite",
    },
  });

  enrichQueryParams(document, "/ai/summarize-thread", "get", {
    threadId: { description: "Gmail thread ID to summarize", example: "THREAD_ID" },
  });

  enrichQueryParams(document, "/contacts/search", "get", {
    q: { description: "Name or email substring", example: "alex" },
  });

  // Legacy inline param enrichment (kept for compatibility)
  const listThreads = document.paths?.["/inbox/threads"]?.get;
  if (listThreads) {
    listThreads.parameters = listThreads.parameters?.map((parameter) => {
      if (parameter.name === "maxResults") {
        return { ...parameter, description: "Page size (1–50)", example: 20 };
      }
      if (parameter.name === "query") {
        return { ...parameter, description: "Gmail search query (same syntax as Gmail)", example: "is:unread" };
      }
      if (parameter.name === "pageToken") {
        return { ...parameter, description: "Gmail pagination token from previous response" };
      }
      return parameter;
    });
  }

  const listEvents = document.paths?.["/calendar/events"]?.get;
  if (listEvents) {
    listEvents.parameters = listEvents.parameters?.map((parameter) => {
      if (parameter.name === "timeMin") {
        return { ...parameter, description: "ISO 8601 range start", example: "2026-06-01T00:00:00Z" };
      }
      if (parameter.name === "timeMax") {
        return { ...parameter, description: "ISO 8601 range end", example: "2026-06-30T23:59:59Z" };
      }
      return parameter;
    });
  }

  return document;
}
