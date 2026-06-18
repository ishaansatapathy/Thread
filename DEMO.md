# Thread — Hackathon Judge Demo Guide

> **Thread** is an AI Chief of Staff for Gmail + Google Calendar, built entirely on the **Corsair SDK**. Every inbox action, calendar operation, and AI feature is powered by live Corsair API calls — not mocked data.

---

## Quick Links

| What | Where |
|------|-------|
| Live App | `https://thread-web.vercel.app` |
| Demo Login | `https://thread-web.vercel.app/api-auth/demo?next=/brief` |
| **Scalar API Docs** | `https://thread-api.vercel.app/docs` |
| OpenAPI JSON | `https://thread-api.vercel.app/openapi.json` |
| MCP Server | `POST https://thread-api.vercel.app/mcp` |
| **Pitch deck (X)** | [Full walkthrough](https://x.com/i/status/2067656941967679952) |
| Demo clips (X) | [Clip 1](https://x.com/i/status/2067065490665824474) · [2](https://x.com/i/status/2066048923446509906) · [3](https://x.com/i/status/2065872033465208947) · [4](https://x.com/i/status/2065345490581962875) · [5](https://x.com/i/status/2065344446368202923) · [6](https://x.com/i/status/2064950664061677607) |

---

## Judge visuals (screenshots & clips)

Use these when reviewing or for the submission form. **Live URLs** work even without local PNGs.

| Screen | What judges should see | Open |
|--------|------------------------|------|
| **Daily Brief** | Corsair Gmail + Calendar + OpenAI synthesis, “Needs attention” cards | [Live `/brief`](https://thread-web.vercel.app/brief) |
| **AI Agent** | Streaming chat, 57 tools, session sidebar, focus chip (thread/event) | [Live `/agent`](https://thread-web.vercel.app/agent) |
| **Approval Queue** | HITL — nothing sends until Approve | [Live `/queue`](https://thread-web.vercel.app/queue) |
| **Inbox** | Cache-first Gmail, priority tab, DB search toggle, attachments | [Live `/inbox`](https://thread-web.vercel.app/inbox) |
| **Calendar** | Events + queued reschedule/cancel, DB search | [Live `/calendar`](https://thread-web.vercel.app/calendar) |
| **Scalar API docs** | Full OpenAPI reference, Corsair map, MCP appendix | [Live `/docs`](https://thread-api.vercel.app/docs) |

**Video walkthroughs (X / Twitter):** [Clip 1](https://x.com/i/status/2067065490665824474) · [2](https://x.com/i/status/2066048923446509906) · [3](https://x.com/i/status/2065872033465208947) · [4](https://x.com/i/status/2065345490581962875) · [5](https://x.com/i/status/2065344446368202923) · [6](https://x.com/i/status/2064950664061677607)

> **Contextual memory (not a stateless chatbot):** Agent **sessions** persist in Postgres, **tool memory** recalls prior tool results per session, and **focus** pins a Gmail thread or Calendar event into the system prompt.

---

## 3-Minute Judge Walkthrough

### Step 1 — AI Daily Brief (`/brief`) ★ Lead Feature

Open: `https://thread-web.vercel.app/brief`

The brief calls 6 live Corsair APIs per render:
- **Corsair Gmail** — unread threads, pending replies, starred items
- **Corsair Calendar** — today's meetings, next free window
- **OpenAI gpt-4o-mini** — synthesises everything into actionable sections

**Click "Needs attention"** → agent opens with pre-filled prompt. Agent takes action → brief updates on return (client-side dismissal via localStorage).

**Scoring signal**: Live Corsair calls, OpenAI synthesis, real-time Gmail/Calendar data, human-in-the-loop queue.

---

### Step 2 — AI Agent (`/agent`) ★ Corsair Depth

Open: `https://thread-web.vercel.app/agent`

The agent has **57 tools** backed by Corsair — **full parity** with the Thread MCP server (`mcp-server.json` v2.5.0):

| Category | Tools |
|----------|-------|
| Gmail reads | `list_inbox`, `search_inbox`, `get_thread`, `list_messages`, `rank_inbox`, `get_gmail_connection_status` |
| Gmail writes | `queue_email`, `archive_thread`, `star_thread`, `unstar_thread`, `mark_important`, `trash_thread`, `untrash_thread`, `mark_thread_read`, `modify_message`, `batch_modify_threads` |
| Labels | `list_labels`, `apply_label`, `remove_label` |
| Drafts | `list_drafts`, `get_draft`, `update_draft`, `delete_draft`, `send_draft` (queued) |
| Queue | `list_queue`, `approve_queue_item`, `dismiss_queue_item` |
| Calendar | `queue_calendar_invite`, `quick_add_event` (queued), `list_calendar_events`, `check_free_busy`, `respond_to_event`, `reschedule_event` (queued), `cancel_event` (queued), `update_event_details` (queued) |
| Corsair DB search | `search_threads_db`, `search_messages_db`, `search_drafts_db`, `search_labels_db`, `search_events_db`, `search_calendars_db` |
| AI | `get_daily_brief`, `get_smart_replies`, `get_meeting_prep`, `get_thread_context`, `get_missed_followups`, `get_contact_intel`, `summarize_thread` |

**Try these prompts:**
```
"What's in my inbox today? Star the most urgent one."
"Draft a reply to the last email from Alice thanking her."
"Am I free tomorrow 2-3pm? If yes, schedule a standup with the team."
"What's the context on the thread from Bob? Give me smart replies."
"Check missed follow-ups from last week's meetings."
```

Every tool call goes through Corsair — **zero direct Gmail/Calendar API calls** in the agent.

**Safety layers**: Injection detection → token limit check → fingerprint dedup → per-session send cap → Human-in-the-Loop queue → Zod validation.

---

### Step 3 — Human-in-the-Loop Queue (`/queue`)

Every AI-composed email and calendar invite goes through approval. Open `/queue` to:
- **Approve** → sends via Corsair Gmail API / Corsair Calendar API
- **Dismiss** → discards without sending
- **Auto-approve settings** → `/settings` lets you pre-approve email sends, drafts, calendar invites per category

---

### Step 4 — Scalar API Docs (★ judge docs)

Open: **https://thread-api.vercel.app/docs**

ChaiForm-style **Scalar** reference — every REST route documented with:

- **Intro guide** — Corsair map, auth, queue, MCP, webhooks, demo login
- **Tag groups** — Gmail, Calendar, Queue, Agent, MCP & Webhooks
- **Request examples** — queue email, calendar invite, quick-add, agent chat, RSVP
- **Reference paths** — `/mcp`, `/mcp/corsair`, `/webhooks/*`, `/agent/stream`, OAuth connect

Local: `http://localhost:8000/docs` · JSON: `/openapi.json`

Judge walkthrough: **`JUDGE_WALKTHROUGH.md`** (60s Scalar section)

```bash
# OpenAPI spec (for import into Postman / Insomnia)
curl -s https://thread-api.vercel.app/openapi.json | head -c 400
```

### Step 5 — MCP Server (live curl)

```bash
# Initialize
curl -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# List all 57 tools
curl -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# List MCP resources
curl -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"resources/list"}'

# List MCP prompts
curl -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"prompts/list"}'

# Get a prompt template
curl -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"prompts/get","params":{"name":"daily_brief","arguments":{"timeZone":"Asia/Kolkata"}}}'

# Call a tool (authenticated)
curl -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"list_inbox","arguments":{"maxResults":5}}}'
```

MCP exposes: `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, `initialize` — **full MCP 2024-11-05 compliance**.

**Official Corsair MCP** (`@corsair-dev/mcp` at `/mcp/corsair`) — **same auth as `/mcp`** (session cookie or `Authorization: Bearer` + env-bound API key):

```bash
# List Corsair dynamic tools (list_operations, get_schema, run_script, corsair_setup)
curl -X POST https://thread-api.vercel.app/mcp/corsair \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_THREAD_MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/list"}'

# Discover all Gmail + Calendar SDK operations
curl -X POST https://thread-api.vercel.app/mcp/corsair \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_THREAD_MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"list_operations","arguments":{}}}'
```

After Gmail/Calendar OAuth connect, **`setupCorsair({ backfill: true })`** seeds `corsair_entities` from list endpoints automatically.

---

### Step 6 — MCP + AI Workflows (★ Corsair depth for judges)

These show **live Corsair + MCP + human-in-the-loop** in one flow:

| # | Workflow | How to demo | Corsair signal |
|---|----------|-------------|----------------|
| 1 | **Inbox → Agent → Queue → Send** | Agent: *"Draft a thank-you to the last email from [name]"* → `/queue` → Approve | Gmail read + draft queue + `messages.send` on approve |
| 2 | **Calendar quick-add via MCP** | MCP `quick_add_event` with *"Standup tomorrow 10am"* → dashed block on `/calendar` → Approve | Local NLP → queue → `events.create` |
| 3 | **DB search (offline-fast)** | Agent: *"Search my synced threads for hackathon"* → uses `search_threads_db` | `corsair.gmail.db.threads.search` — no live API round-trip |
| 4 | **Webhook sync** | Send yourself a Gmail → inbox updates within ~15s (SSE + webhook) | Pub/Sub watch + `history.list` incremental sync |
| 5 | **Official Corsair MCP** | `/mcp/corsair` → `list_operations` → `run_script` for any SDK endpoint | Dynamic discovery — full Corsair platform |

**Cursor / Claude Desktop config:** point MCP at `POST /mcp` with your Thread session or API key — all 57 domain tools + 4 official Corsair adapter tools.

---

### Step 7 — More AI Features

| Feature | Route | What it does |
|---------|-------|-------------|
| Smart Replies | `/inbox?thread=X` (Context Panel) | 3 AI suggestions per thread via Corsair Gmail + OpenAI |
| Meeting Prep | `/calendar` → click event | Agenda, talking points, risks, related emails via Corsair Calendar + Gmail |
| Thread Summarization | Context Panel | Key decisions, action items, next steps |
| Contact Intelligence | Agent: `get_contact_intel` | Response rate, topics, relationship summary |
| Missed Follow-ups | `/brief` → Attention section | Meetings with no follow-up email |
| Inbox Priority Ranking | `/inbox` | AI-ranked inbox by urgency |

---

## Corsair Integration Map

| Capability | Corsair API Used | Where |
|-----------|-----------------|-------|
| Gmail OAuth connect | `generateOAuthUrl`, `processOAuthCallback` | `/connect/gmail` |
| List/search threads | `corsair.gmail.api.threads.list` | Inbox, Agent, Brief |
| Read thread detail | `corsair.gmail.api.threads.get` | Thread view, AI |
| Send email | `corsair.gmail.api.messages.send` | Queue approve, Agent |
| Create draft | `corsair.gmail.api.drafts.create` | Queue, Agent |
| Read/delete draft | `corsair.gmail.api.drafts.get/delete` | Agent |
| Modify labels | `corsair.gmail.api.threads.modify` | Archive, star, read, important |
| List labels | `corsair.gmail.api.labels.list` | Agent, MCP |
| Gmail push watch | `corsair.gmail.api.users.watch` | Webhook registration |
| Calendar OAuth | `generateOAuthUrl`, `processOAuthCallback` | `/connect/calendar` |
| List events | `corsair.googlecalendar.api.events.getMany` | Calendar, Brief, MCP |
| Get single event | `corsair.googlecalendar.api.events.get` | Meeting Prep (O(1)) |
| Create event | `corsair.googlecalendar.api.events.create` | Queue approve, Agent |
| Update event | `corsair.googlecalendar.api.events.update` | Reschedule, respond, cancel |
| Free/busy check | `corsair.googlecalendar.api.calendar.getAvailability` | Agent, MCP, Calendar UI |
| Gmail DB search | `corsair.gmail.db.{threads,messages,drafts,labels}.search` | Inbox cache, Agent, MCP |
| Calendar DB search | `googlecalendar.db.{events,calendars}.search` | Agent, MCP |
| Webhooks | `processWebhook` + `webhookHooks` | `POST /webhooks/corsair` (also `/webhooks/gmail`, `/webhooks/calendar`) |
| Permissions | `cautious` mode + `executePermission` | `/corsair/approve/:token`, `POST /corsair/permissions/:token/approve` |
| API hooks | `hooks` on gmail + googlecalendar plugins | Metrics via `incrementCounter` |
| Error handling | Root `errorHandlers` (429 + 5xx retry) | `createCorsair({ errorHandlers })` |
| Management API | `toExpressHandler` | `GET/POST /api/corsair/*` |
| Official MCP | `@corsair-dev/mcp` | `POST /mcp/corsair` |
| DB backfill | `setupCorsair({ backfill: true })` | After OAuth connect (Gmail + Calendar callbacks) |
| Webhook channel | `corsair.googlecalendar.api.channels.stop/watch` | Webhook registration |
| Tenant management | `getCorsair().manage.connectionStatus.get` | Connection checks |
| Multi-tenancy | `getCorsair().withTenant(tenantId)` | All Corsair calls |

**Total Corsair calls in codebase: 55+** across Gmail and Calendar APIs + DB search layer.

---

## Engineering Highlights (Production Quality)

### Security
- **Prompt injection detection** — pattern-match + heuristic scoring on every agent message
- **Email validation** — Zod schema + RFC-5321 address validation before any send
- **Send cap** — max 3 AI email sends per session (prevents runaway LLM)
- **Fingerprint dedup** — identical emails blocked within the same agent request
- **Rate limiting** — Redis per-user and per-IP rate limits on both API and MCP server

### Architecture
- **Shared tool executor** (`agent-executor.ts`) — single source of truth for 57 tools, used by both blocking and streaming agent variants
- **Zero duplication** — `agent.ts` and `agent-stream.ts` are thin wrappers over `buildToolExecutor()`
- **Brief server cache** — 5-minute per-user TTL cache prevents 6 Corsair calls per browser focus event
- **Meeting prep O(1)** — `calendar.getEvent(id)` direct fetch vs. previous list+find scan
- **Proper ORM access** — integration renewal queries own users table via Drizzle ORM (no raw Corsair DB SQL)

### Observability
- Prometheus metrics on all key operations
- OpenTelemetry tracing
- Structured logging via `@repo/logger` on all tool calls
