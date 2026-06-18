# Thread — Technical Documentation

> **AI Chief of Staff** for Gmail + Google Calendar, built on the [Corsair SDK](https://corsair.dev) for the Corsair Hackathon.

| Resource | URL |
|----------|-----|
| Web app | https://thread-web.vercel.app |
| **Scalar API docs** | https://thread-api.vercel.app/docs |
| OpenAPI JSON | https://thread-api.vercel.app/openapi.json |
| Thread MCP | `POST https://thread-api.vercel.app/mcp` |
| Official Corsair MCP | `POST https://thread-api.vercel.app/mcp/corsair` |

Related: [`README.md`](README.md) · [`DEMO.md`](DEMO.md) · [`JUDGE_WALKTHROUGH.md`](JUDGE_WALKTHROUGH.md) · [`mcp-server.json`](mcp-server.json)

---

## 1. Architecture

```
Next.js (web)  ──tRPC/REST──►  Express API  ──Corsair SDK──►  Gmail + Calendar
     │                              │
     │                              ├── Postgres (users, queue, sessions)
     │                              ├── MCP (57 tools)
     │                              └── Webhooks (Pub/Sub + push)
     └── SSE /sync/events ◄─────────┘
```

| Component | Stack |
|-----------|-------|
| Frontend | Next.js 16, React Query, tRPC client |
| API | Express, tRPC v11, trpc-to-openapi → Scalar |
| Integration | Corsair SDK — OAuth, encrypted tokens, permissions |
| AI | OpenAI gpt-4o-mini |
| MCP | MCP 2024-11-05 — 57 domain tools + `@corsair-dev/mcp` |

---

## 2. Authentication

### Browser (web app)

1. `POST /api/authentication/sign-in` → httpOnly `jwt` + `jwt_refresh` cookies
2. Protected routes require valid `jwt`
3. Mutations need `X-Thread-CSRF: 1` + trusted `Origin`

### Headless / MCP

```
Authorization: Bearer <THREAD_MCP_API_KEY>
```

Must match `THREAD_MCP_USER_ID` env — scoped, no arbitrary impersonation.

### Corsair OAuth

| Integration | URL |
|-------------|-----|
| Gmail | `/api-connect/gmail` (Next.js) |
| Calendar | `/api-connect/calendar` (Next.js) |

Tokens encrypted with `CORSAIR_KEK`.

---

## 3. REST API (~116 endpoints)

All REST routes live under **`/api/*`** and are documented in Scalar with:

- Per-endpoint **summary + description**
- **Corsair API mapping** (Gmail / Calendar / DB search)
- **MCP tool parity** where applicable
- **Request examples** on major POST/PATCH routes
- **curl code samples** on key flows

### Tag groups (Scalar sidebar)

| Group | Tags |
|-------|------|
| Getting started | Authentication, Health |
| Corsair Gmail | Inbox |
| Corsair Calendar | Calendar |
| Approval queue | Queue |
| AI & Agent | AI, Agent, Brief |
| Platform | Contacts, Settings, MCP & Webhooks |

### Corsair Gmail (`/api/inbox/*`)

| Endpoint | Corsair operation |
|----------|-------------------|
| `GET /inbox/threads` | `threads.list` |
| `GET /inbox/threads/{id}` | `threads.get` |
| `POST /inbox/send` | `messages.send` |
| `POST /inbox/drafts` | `drafts.create` |
| `PUT /inbox/drafts/{id}` | `drafts.update` |
| `POST /inbox/threads/{id}/archive` | `threads.modify` |
| `GET /inbox/db/*/search` | `corsair.gmail.db.*.search` |

### Corsair Calendar (`/api/calendar/*`)

| Endpoint | Corsair operation |
|----------|-------------------|
| `GET /calendar/events` | `events.list` |
| `POST /calendar/events` | `events.create` |
| `PATCH /calendar/events/{id}/reschedule` | `events.patch` |
| `POST /calendar/free-busy` | `freebusy.query` |
| `GET /calendar/db/*/search` | `googlecalendar.db.*.search` |

### Approval queue (`/api/queue/*`)

| Kind | On approve |
|------|------------|
| `email_send` | `messages.send` |
| `email_draft` | `drafts.create` |
| `draft_send` | `drafts.send` |
| `calendar_invite` | `events.create` |
| `meeting_bundle` | `events.create` + `messages.send` |
| `calendar_archive` | `events.patch` (reschedule) |
| `calendar_delete` | `events.delete` |
| `calendar_update` | `events.patch` (title, description, location) |

State machine: `pending → processing → approved | failed` · dismiss → `dismissed`

---

## 4. MCP (57 tools)

**Endpoint:** `POST /mcp` (JSON-RPC 2.0)

### Public (no auth)

- `initialize`
- `tools/list`
- `resources/list`
- `prompts/list`

### Protected

- `tools/call` — requires cookie or bearer
- `resources/read`, `prompts/get`

### Tool categories

| Category | Count | Examples |
|----------|-------|----------|
| Gmail read | 8 | `list_inbox`, `get_thread`, `list_messages` |
| Gmail write | 20 | `archive_thread`, `queue_email`, `batch_modify_threads` |
| Queue | 4 | `list_queue`, `approve_queue_item` |
| Calendar | 10 | `quick_add_event`, `check_free_busy` |
| Connection | 2 | `get_gmail_connection_status` |
| AI | 7 | `get_daily_brief`, `rank_inbox`, `summarize_thread` |
| DB search | 6 | `search_threads_db`, `search_events_db` |

**CI parity:** `packages/services/ai/tool-parity.test.ts` asserts Agent tools === MCP manifest.

### Official Corsair MCP

`POST /mcp/corsair` — `@corsair-dev/mcp`:

- `corsair_setup`
- `list_operations`
- `get_schema`
- `run_script`

### Example curl

```bash
# List all 57 tools (no auth)
curl -s -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Queue email via MCP (auth required)
curl -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_MCP_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"queue_email","arguments":{"to":"a@b.com","subject":"Hi","body":"Hello"}}}'
```

---

## 5. Webhooks & real-time sync

| Webhook | Purpose |
|---------|---------|
| `POST /webhooks/gmail` | Pub/Sub → incremental `history.list` sync |
| `POST /webhooks/calendar` | Push channel → refresh events |
| `POST /webhooks/corsair` | Corsair plugin hooks |

**UI SSE:** `GET /sync/events` — invalidates inbox/calendar cache on sync.

Daily cron renews Gmail watch + Calendar channels (`integration-renewal`).

---

## 6. AI & Agent

| Feature | REST | Data source |
|---------|------|-------------|
| Daily Brief | `GET /brief`, `GET /ai/daily-brief` | Corsair + OpenAI |
| Inbox ranking | `POST /ai/inbox/rank` | Corsair threads + OpenAI |
| Agent chat | `POST /agent/chat` | 57 Corsair tools |
| Agent stream | `POST /agent/stream` | Same tools, SSE |

Agent guardrails: injection detection, send cap, email body fencing, token budget.

---

## 7. Non-REST endpoints (Scalar reference section)

| Path | Method | Purpose |
|------|--------|---------|
| `/health` | GET | Liveness |
| `/ready` | GET | Readiness (DB + Corsair) |
| `/metrics` | GET | Prometheus metrics |
| `/sync/events` | GET | SSE sync stream |
| `/openapi.json` | GET | OpenAPI spec |
| `/docs` | GET | This Scalar UI |
| `/api/corsair/*` | * | Corsair management API |
| `/api-connect/gmail` | GET | OAuth start (Next.js) |
| `/api-connect/calendar` | GET | OAuth start (Next.js) |

---

## 8. Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres |
| `JWT_SECRET` | Yes | Session tokens |
| `CORSAIR_KEK` | Yes | Encrypt OAuth tokens |
| `CORSAIR_DEV_KEY` | Yes | Corsair SDK |
| `OPENAI_API_KEY` | For AI | Agent, brief, ranking |
| `CORSAIR_WEBHOOK_SECRET` | Prod | Webhook validation |
| `THREAD_MCP_API_KEY` | MCP scripts | Headless auth |
| `THREAD_MCP_USER_ID` | MCP scripts | Bound user |
| `PUBLIC_OPENAPI_DOCS` | Optional | Open `/docs` in prod |

See `.env.example` for the full list.

---

## 9. Local development

```bash
pnpm install
cp .env.example .env   # fill Corsair + OpenAI keys
pnpm db:migrate
pnpm dev
```

- API: http://localhost:8000
- Scalar: http://localhost:8000/docs (set `PUBLIC_OPENAPI_DOCS=true`)
- Web: http://localhost:3000

---

## 10. Judge checklist (documentation)

| Criterion | Evidence |
|-----------|----------|
| Interactive API docs | Scalar at `/docs` |
| Every endpoint documented | ~116 REST + reference paths |
| Corsair mapping | Per-endpoint descriptions + intro matrix |
| Request examples | Queue, auth, agent, calendar, inbox |
| curl samples | Sign-in, threads, queue, MCP |
| MCP manifest | `mcp-server.json` v2.5.0 + tool appendix in Scalar intro |
| Demo script | `DEMO.md` |
| Walkthrough | `JUDGE_WALKTHROUGH.md` |
