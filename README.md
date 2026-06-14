# Thread — Gmail + Calendar Productivity App

A full-stack productivity application built on the [Corsair SDK](https://corsair.dev) that brings Gmail and Google Calendar into a focused, human-in-the-loop workflow. Built for the Corsair Hackathon.

## What it does

- **Inbox** — Cache-first Gmail inbox with stale-while-revalidate, search, thread reader, and keyboard navigation (`j/k/Enter/`/)
- **AI Priority** — Rank inbox threads by urgency using OpenAI
- **Queue** — Every outbound action (email send, draft save, calendar invite) is staged here for your approval before it executes — nothing sends without your OK
- **Agent** — Plain-language AI assistant with streaming responses. Ask it to send emails, rank your inbox, schedule meetings, or check your queue
- **Calendar** — View and manage events; create/reschedule/delete through the approval queue
- **MCP Server** — Full Model Context Protocol server at `/mcp` so other AI tools (Claude, Cursor, etc.) can use your inbox and queue directly

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                             │
│  Next.js 15 (apps/web)                                      │
│  ├── /inbox    — Gmail inbox (cache-first, SWR)             │
│  ├── /queue    — Human approval queue                       │
│  ├── /agent    — AI chat (SSE streaming)                    │
│  ├── /calendar — Event management                           │
│  └── /settings — Auto-approve preferences                   │
└────────────────────┬────────────────────────────────────────┘
                     │  tRPC + REST (OpenAPI)
┌────────────────────▼────────────────────────────────────────┐
│                    Express API (apps/api)                    │
│  ├── /trpc          — Type-safe tRPC procedures             │
│  ├── /mcp           — MCP 2024-11 / JSON-RPC 2.0 server     │
│  ├── /agent/stream  — SSE streaming agent responses         │
│  ├── /auth/corsair  — Gmail + Calendar OAuth callbacks      │
│  ├── /webhooks      — Gmail push notification handler       │
│  ├── /metrics       — Prometheus-compatible metrics         │
│  ├── /health        — Database health check                 │
│  └── /docs          — Scalar OpenAPI reference              │
└──────────┬──────────────────────┬───────────────────────────┘
           │                      │
┌──────────▼──────────┐  ┌────────▼────────────────────────────┐
│   PostgreSQL        │  │   Corsair SDK                        │
│   (Neon / local)    │  │   ├── Gmail API (threads, messages)  │
│   Drizzle ORM       │  │   ├── Google Calendar API            │
│   ├── users         │  │   ├── OAuth management               │
│   ├── queue_items   │  │   └── Push webhook delivery          │
│   ├── mail_cache    │  └─────────────────────────────────────┘
│   └── contacts      │
└─────────────────────┘
```

### Key packages

| Package | Purpose |
|---------|---------|
| `apps/web` | Next.js frontend |
| `apps/api` | Express API server |
| `packages/trpc` | Shared tRPC router + procedures |
| `packages/services` | Domain services (inbox, queue, calendar, AI agent) |
| `packages/database` | Drizzle schema + migrations |

---

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- **PostgreSQL** (local Docker or [Neon](https://neon.tech) free tier)
- **Corsair account** — [corsair.dev](https://corsair.dev) (free tier works)
- **Google Cloud project** with Gmail API + Google Calendar API enabled
- **OpenAI API key** (for AI features; optional but required for agent/ranking)

---

## Quick start

### 1. Clone and install

```bash
git clone <repo-url>
cd "Corsair Hackathon"
pnpm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables:

```env
# Database
DATABASE_URL=postgresql://...        # Pooled connection (app)
DATABASE_URL_UNPOOLED=postgresql://... # Direct connection (migrations)

# Auth
JWT_SECRET=<random-32-char-string>
JWT_REFRESH_SECRET=<random-32-char-string>

# Google OAuth (for user sign-in with Google)
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...

# Corsair (Gmail + Calendar integration)
CORSAIR_API_KEY=...                  # From corsair.dev dashboard
CORSAIR_GMAIL_CLIENT_ID=...          # Google OAuth app for Gmail
CORSAIR_GMAIL_CLIENT_SECRET=...
CORSAIR_CALENDAR_CLIENT_ID=...       # Google OAuth app for Calendar
CORSAIR_CALENDAR_CLIENT_SECRET=...

# OpenAI (optional — for Agent + Priority ranking)
OPENAI_API_KEY=sk-...

# App URLs
NEXT_PUBLIC_API_URL=http://localhost:8000
CLIENT_URL=http://localhost:3000
BASE_URL=http://localhost:8000
```

### 3. Set up Corsair

```bash
pnpm --filter @repo/api corsair:setup
```

This provisions the Gmail plugin and does an initial backfill.

### 4. Run migrations

```bash
pnpm db:migrate
```

### 5. Start dev servers

```bash
pnpm dev
```

This starts both the Next.js frontend (`:3000`) and Express API (`:8000`) in watch mode.

---

## Development commands

```bash
pnpm dev              # Start all services
pnpm build            # Production build
pnpm check-types      # TypeScript type-check (all packages)
pnpm lint             # ESLint (all packages)
pnpm test             # Vitest unit tests (API package)
pnpm db:migrate       # Run Drizzle migrations
pnpm db:studio        # Open Drizzle Studio (DB GUI)
```

### E2E tests

```bash
cd apps/web
pnpm exec playwright test
```

For Gmail integration tests (requires a real session):

```bash
E2E_GMAIL_AVAILABLE=true E2E_SESSION_COOKIE="jwt=..." pnpm exec playwright test e2e/gmail-flows.spec.ts
```

---

## MCP Server

Thread exposes a full [Model Context Protocol](https://modelcontextprotocol.io) server at `POST /mcp`.

### Tools

| Tool | Description |
|------|-------------|
| `list_inbox` | List recent Gmail threads |
| `search_inbox` | Gmail query syntax search |
| `get_thread` | Full thread content |
| `list_queue` | Pending approval items |
| `approve_queue_item` | Approve → sends email / creates event |
| `dismiss_queue_item` | Reject without sending |
| `get_gmail_connection_status` | Check connection |

### Using with Cursor / Claude

Point your AI tool at the MCP server using `mcp-server.json` in the project root, or configure manually:

```json
{
  "mcpServers": {
    "thread": {
      "url": "http://localhost:8000/mcp",
      "type": "http"
    }
  }
}
```

Auth uses the same JWT cookies as the web app. Sign in at `http://localhost:3000/sign-in` first.

### Quick test (no auth needed)

```bash
# Discover tools
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## Observability

```bash
# Prometheus-compatible metrics (requires DOCS_SECRET header)
curl http://localhost:8000/metrics -H "Authorization: Bearer $DOCS_SECRET"

# JSON metrics
curl http://localhost:8000/metrics/json -H "Authorization: Bearer $DOCS_SECRET"

# Health
curl http://localhost:8000/health

# Readiness
curl http://localhost:8000/ready
```

Metrics tracked:
- Per-route p50 / p95 / p99 latency
- Request counts + error rates
- `inbox.cache_hit` — cache-warm inbox loads
- `queue.approved.total` / `queue.dismissed.total`
- `mcp.tool.<name>` — per-tool MCP call counts

---

## API Documentation

Available at `http://localhost:8000/docs` (requires `DOCS_SECRET` env var or query param `?key=<secret>`).

---

## Demo

### Quick demo login

The app ships with a one-click demo login that bypasses the sign-up + email verification flow.

**Step 1 — seed the demo user** (once, after migrations):

```bash
pnpm db:seed
```

This creates:

| Field | Value |
|-------|-------|
| Email | `demo@thread.dev` (or `SEED_USER_EMAIL`) |
| Password | `DemoPass123!` (or `SEED_DEMO_PASSWORD`) |

**Step 2 — enable demo login** in `.env`:

```env
DEMO_LOGIN_ENABLED=true
DEMO_USER_EMAIL=demo@thread.dev
DEMO_USER_PASSWORD=DemoPass123!
```

**Step 3 — open the demo URL**:

```
http://localhost:3000/api-auth/demo?next=/inbox
```

This signs in automatically and redirects to the inbox. No email verification required.

### Manual sign-in

Alternatively, sign up normally at `http://localhost:3000/sign-up` with any email, verify it, then sign in.

### Connecting Gmail + Calendar

After signing in, go to `/inbox` → **Connect Gmail** (top right) and follow the OAuth flow. Repeat for Calendar at `/calendar`.

Once connected, the agent and inbox are fully live against your real Gmail account.

---

## Security notes

- All outbound actions go through the human-in-the-loop queue — nothing sends without explicit approval
- Agent has 5 layers of guardrails: injection detection, email validation, per-session send cap (3), data fencing, token limit
- Rate limiting: auth (40/15min), agent (20/min/user), MCP (60/min/user)
- JWT with refresh rotation, account lockout after 5 failures
- CSRF protection via `requireTrustedOrigin` on all state-changing requests
