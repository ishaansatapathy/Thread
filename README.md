# Thread — Gmail + Calendar Productivity App

> **Judge / Evaluator?** → Start with **[DEMO.md](./DEMO.md)** for a 3-minute walkthrough, MCP curl examples, and the full Corsair integration map.

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
│  ├── /sync/events   — SSE webhook → client cache invalidation │
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
# Database (Neon free tier or local Docker)
DATABASE_URL=postgresql://...           # Pooled connection (app runtime)
DATABASE_URL_UNPOOLED=postgresql://...  # Direct connection (migrations)

# Auth — generate with: openssl rand -base64 32
JWT_SECRET=<random-32-char-string>
JWT_REFRESH_SECRET=<random-32-char-string>

# Google OAuth (user sign-in with Google)
# Create at: https://console.cloud.google.com → APIs & Services → Credentials
# Authorized redirect URI: http://localhost:3000/api-auth/google/callback
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api-auth/google/callback

# Corsair — Gmail + Calendar integration (https://corsair.dev → Dashboard → API Keys)
# CORSAIR_KEK: 32-byte secret for encrypting OAuth tokens at rest
#   generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
CORSAIR_DEV_KEY=ch_your-corsair-dev-key
CORSAIR_KEK=<base64-encoded-32-byte-key>
CORSAIR_GMAIL_REDIRECT_URI=http://localhost:3000/api-connect/gmail/callback
APP_URL=http://localhost:3000

# OpenAI (optional — enables Agent + Priority inbox ranking)
# OPENAI_API_KEY=sk-proj-...
# OPENAI_MODEL=gpt-4o-mini

# App URLs
CLIENT_URL=http://localhost:3000
BASE_URL=http://localhost:8000
API_INTERNAL_URL=http://localhost:8000
NEXT_PUBLIC_API_URL=/trpc
```

> **Note on CORSAIR_KEK**: this is a symmetric encryption key, not an API key.
> Use the one-liner above to generate it — any 32 random bytes encoded as base64 works.
> Keep it stable across deployments; rotating it invalidates stored tokens.

### 3. Google Cloud setup (Gmail + Calendar scopes)

In your Google Cloud project (same OAuth client as above, or a separate one):

1. Enable **Gmail API** and **Google Calendar API** in *APIs & Services → Library*.
2. Add the following OAuth scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar`
3. Add authorized redirect URIs:
   - `http://localhost:3000/api-connect/gmail/callback`
   - `http://localhost:3000/api-connect/calendar/callback`
4. Copy the Client ID and Secret — these are the same `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` used for user sign-in.

### 4. Run migrations

```bash
pnpm db:migrate
```

> **Note**: If you want Gmail push notifications in production (real-time inbox updates), see the
> [Gmail Pub/Sub webhook setup](#gmail-pubsub-webhooks-production) section below.

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

CI runs with `THREAD_E2E_MOCK_GMAIL=true` so **compose → queue → approve** works without live Gmail OAuth (`e2e/queue-workflow.spec.ts`).

For live Gmail integration (optional — requires connected account):

```bash
E2E_GMAIL_AVAILABLE=true E2E_SESSION_COOKIE="jwt=...; jwt_refresh=..." \
  pnpm exec playwright test e2e/gmail-authenticated.spec.ts e2e/gmail-flows.spec.ts
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
| `get_gmail_connection_status` | Check Gmail connection |
| `rank_inbox` | AI urgency ranking |
| `list_calendar_events` | Calendar events in a date range |
| `queue_email` | Queue email for human approval (3 sends/min cap) |
| `queue_calendar_invite` | Queue calendar invite (supports `recurrence` RRULE) |
| `list_labels` | List Gmail labels |
| `archive_thread` | Archive a thread |
| `apply_label` | Apply label to a thread |
| `remove_label` | Remove label from a thread |

Headless MCP auth: set `THREAD_MCP_API_KEY` + `THREAD_MCP_USER_ID` (bound pair — no arbitrary user impersonation). See `mcp-server.json` (v1.5.0, **34 tools**).

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
# Prometheus-compatible metrics (requires OPENAPI_DOCS_SECRET in production)
curl http://localhost:8000/metrics -H "Authorization: Bearer $OPENAPI_DOCS_SECRET"

# JSON metrics
curl http://localhost:8000/metrics/json -H "Authorization: Bearer $OPENAPI_DOCS_SECRET"

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

When `REDIS_URL` is set, counters persist across API restarts and `/metrics/json` merges Redis totals. Webhook-driven inbox/calendar updates also fan out via Redis pub/sub to `/sync/events` SSE clients (multi-instance safe).

---

## API Documentation

Available at `http://localhost:8000/docs` (requires `OPENAPI_DOCS_SECRET` env var or query param `?key=<secret>` in production; open in dev when `PUBLIC_OPENAPI_DOCS=true`).

---

## Gmail Pub/Sub webhooks (production)

In production you can receive real-time Gmail push notifications instead of relying on manual refreshes.

### Setup

**1. Create a Pub/Sub topic and grant Gmail publish rights:**

```bash
gcloud pubsub topics create gmail-push

gcloud pubsub topics add-iam-policy-binding gmail-push \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

**2. Create a push subscription pointing at your API:**

```bash
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-push \
  --push-endpoint=https://api.yourdomain.com/webhooks/gmail \
  --ack-deadline=10
```

**3. Add to `.env`:**

```env
WEBHOOKS_BASE_URL=https://api.yourdomain.com
CORSAIR_WEBHOOK_SECRET=your-random-secret
CORSAIR_GMAIL_TOPIC_ID=projects/YOUR_GCP_PROJECT/topics/gmail-push
```

Thread automatically:
- Registers a Gmail watch on first user connection (or re-registers on OAuth refresh).
- Uses the Gmail **History API** for incremental sync — fetches only changed threads, not the full inbox.
- Persists the latest `historyId` to the database so restarts don't re-fetch everything.
- Falls back to full-list refresh if history is too stale.
- Pushes `inbox_updated` / `calendar_updated` hints to connected browsers via **SSE** (`GET /sync/events`).

### Recurring calendar edits

When rescheduling or deleting a recurring event, choose **This event only**, **All events in the series**, or **This and following events** — all changes go through the approval queue first.

---

## Demo

### Quick demo login

The app ships with a one-click demo login that bypasses the sign-up + email verification flow.

**Step 1 — seed the demo user** (once, after migrations):

```bash
pnpm db:seed
```

This creates (or refreshes) the demo user — **password is re-synced from `SEED_DEMO_PASSWORD` on every seed**:

| Field | Value |
|-------|-------|
| Email | `demo@thread.dev` (or `SEED_USER_EMAIL`) |
| Password | `DemoPass123!` (or `SEED_DEMO_PASSWORD`) |

**Step 2 — enable demo login** in `.env` (recommended for production demo/judging):

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

## Production deployment runbook

### 1. API (Railway / Render / Fly)

Deploy `apps/api` using `railway.toml`. Required env:

| Variable | Example | Notes |
|----------|---------|--------|
| `DATABASE_URL` | `postgresql://…` | Neon pooled URL |
| `CORSAIR_KEK` | `base64:…` | From Corsair dashboard |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | long random strings | ≥32 chars |
| `CLIENT_URL` | `https://app.yourdomain.com` | Web origin (CORS) |
| `BASE_URL` | `https://api.yourdomain.com` | Public API URL |
| `WEBHOOKS_BASE_URL` | `https://api.yourdomain.com` | Gmail/Calendar push targets |
| `CORSAIR_WEBHOOK_SECRET` | random ≥16 chars | Must match Pub/Sub push header |
| `CORSAIR_GMAIL_TOPIC_ID` | `projects/…/topics/gmail-push` | Enables live inbox sync |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | GCP console | Same app as Corsair plugins |
| `OPENAI_API_KEY` | `sk-…` | Agent + priority ranking |
| `DEMO_LOGIN_ENABLED` | `false` | Disable in public prod unless judging |

After deploy: `GET https://api.yourdomain.com/ready` should return `ready: true`.

### 2. Web (Vercel)

Deploy `apps/web` with `vercel.json`. Set:

- `API_INTERNAL_URL=https://api.yourdomain.com`
- `NEXT_PUBLIC_*` vars if used by client

Verify rewrites: `/api-auth/*`, `/agent/stream`, `/inbox/attachments/*` proxy to API.

### 3. Gmail Pub/Sub (production push)

Follow [Gmail Pub/Sub webhooks](#gmail-pubsub-webhooks-production). Push endpoint:

```
https://api.yourdomain.com/webhooks/gmail
```

Header: `x-corsair-webhook-secret: <CORSAIR_WEBHOOK_SECRET>`

### 4. MCP headless access

Set `THREAD_MCP_API_KEY` + `THREAD_MCP_USER_ID` (bound pair) and call MCP with:

```
Authorization: Bearer <THREAD_MCP_API_KEY>
```

The API key is scoped to the user id in `THREAD_MCP_USER_ID` — arbitrary impersonation is not supported.

See `mcp-server.json` for all 34 tools.

### 5. Post-deploy smoke

```bash
curl https://api.yourdomain.com/health
curl https://api.yourdomain.com/ready
node scripts/load-test/health-smoke.mjs https://api.yourdomain.com
```

Sign in → Connect Gmail → send test queue item → approve → verify in Gmail.

---

## Security notes

- All outbound actions go through the human-in-the-loop queue — nothing sends without explicit approval
- Agent has 5 layers of guardrails: injection detection, email validation, per-session send cap (3), data fencing, token limit
- Rate limiting: auth (40/15min), agent (20/min/user), MCP (60/min/user)
- JWT with refresh token revocation on logout and password reset (tokenVersion bump), account lockout after 5 failures
- CSRF protection via `requireTrustedOrigin` on all state-changing requests
