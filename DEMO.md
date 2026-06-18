# Thread — Hackathon Judge Demo Guide

> **Thread** is an AI Chief of Staff for Gmail + Google Calendar, built entirely on the **Corsair SDK**. Every inbox action, calendar operation, and AI feature is powered by live Corsair API calls — not mocked data.

---

## Quick Links

| What | Where |
|------|-------|
| Live App | `https://thread-web.vercel.app` |
| Demo Login | `https://thread-web.vercel.app/api-auth/demo?next=/brief` |
| MCP Server | `POST https://thread-api.vercel.app/mcp` |
| API Docs | `https://thread-api.vercel.app/docs` |

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

The agent has **52 tools** backed by Corsair — in full parity with the MCP server:

| Category | Tools |
|----------|-------|
| Gmail reads | `list_inbox`, `search_inbox`, `get_thread`, `rank_inbox`, `get_gmail_connection_status` |
| Gmail writes | `queue_email` (cc/bcc), `archive_thread`, `star_thread`, `unstar_thread`, `mark_important`, `trash_thread`, `mark_thread_read` |
| Labels | `list_labels`, `apply_label`, `remove_label` |
| Drafts | `list_drafts`, `get_draft`, `delete_draft` |
| Queue | `list_queue`, `approve_queue_item`, `dismiss_queue_item` |
| Calendar | `queue_calendar_invite`, `list_calendar_events`, `check_free_busy`, `respond_to_event`, `reschedule_event`, `cancel_event` |
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

### Step 4 — MCP Server (live curl)

```bash
# Initialize
curl -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# List all 55 tools
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

---

### Step 5 — More AI Features

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
| Webhooks | `processWebhook` + `webhookHooks` | `POST /webhooks/corsair` |
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
- **Shared tool executor** (`agent-executor.ts`) — single source of truth for 52 tools, used by both blocking and streaming agent variants
- **Zero duplication** — `agent.ts` and `agent-stream.ts` are thin wrappers over `buildToolExecutor()`
- **Brief server cache** — 5-minute per-user TTL cache prevents 6 Corsair calls per browser focus event
- **Meeting prep O(1)** — `calendar.getEvent(id)` direct fetch vs. previous list+find scan
- **Proper ORM access** — integration renewal queries own users table via Drizzle ORM (no raw Corsair DB SQL)

### Observability
- Prometheus metrics on all key operations
- OpenTelemetry tracing
- Structured logging via `@repo/logger` on all tool calls

---

## Score Mapping

| Category | Max | Our Coverage |
|----------|-----|-------------|
| Corsair Integration | 20 | OAuth, multi-tenancy, 40+ API calls, webhooks, connection status |
| Gmail Workflow | 15 | Send/draft (cc/bcc), labels, archive, star, important, trash, read |
| Calendar Workflow | 15 | Create, update, cancel, respond, free/busy, push notifications |
| Productivity UX | 15 | Brief, Smart Reply, Meeting Prep, Contact Intel, Summarize, Follow-ups |
| AI + MCP Usage | 15 | 52-tool agent, 55-tool MCP server, resources, prompts, streaming SSE |
| Engineering Quality | 10 | Type-safe, no duplication, rate limiting, injection guard, ORM, cache |
| Demo + Docs | 10 | This guide + README + curl examples + live app |
