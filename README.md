# Thread — Corsair Hackathon

**Thread** is a Gmail + Google Calendar workflow app with a human-in-the-loop **approval queue**. Nothing sends or schedules until you approve it in Queue.

Built for the Corsair Hackathon using **Corsair MCP** (Gmail + Calendar), **tRPC**, **OpenAPI REST**, **Drizzle/Postgres**, and optional **OpenAI** for inbox priority ranking.

## Quick start

```bash
pnpm install
pnpm db:up          # local Postgres (optional if using Neon)
pnpm db:migrate
pnpm dev
```

| App | URL |
|-----|-----|
| Web | http://localhost:3000 |
| API | http://localhost:8000 |
| OpenAPI spec | http://localhost:8000/openapi.json |
| API docs (Scalar) | http://localhost:8000/docs |

Copy `.env.example` → `.env` and fill in secrets (see [Environment](#environment)).

## Architecture

```
┌─────────────┐     tRPC (cookie + CSRF)      ┌──────────────┐
│  Next.js    │ ─────────────────────────────▶│  Express API │
│  apps/web   │                               │  apps/api    │
└─────────────┘                               └──────┬───────┘
                                                     │
                     ┌───────────────────────────────┼───────────────────────────────┐
                     │                               │                               │
                     ▼                               ▼                               ▼
              ┌─────────────┐                ┌─────────────┐                ┌─────────────┐
              │  Postgres   │                │   Corsair   │                │   OpenAI    │
              │  (Neon ok)  │                │ Gmail + Cal │                │  (optional) │
              └─────────────┘                └─────────────┘                └─────────────┘
```

### Packages

| Package | Role |
|---------|------|
| `apps/web` | Next.js UI — Inbox, Queue, Calendar, Settings |
| `apps/api` | Express + tRPC + OpenAPI REST + Corsair adapters |
| `packages/trpc` | Shared tRPC routers (Zod in/out, OpenAPI metadata) |
| `packages/services` | Domain interfaces, auth, AI, validation |
| `packages/database` | Drizzle schema + versioned migrations |

### Core flow (approval queue)

1. **Inbox** — read Gmail, compose reply or meeting → **Add to queue**
2. **Queue** — review pending items → **Approve** or **Dismiss**
3. **Approve** — atomically claims item, executes via Corsair (send email / create event)
4. **Calendar** — live Google events; queued invites show as dashed blocks until approved

Direct send is **disabled by default** (`THREAD_ALLOW_DIRECT_SEND` must be `true` to bypass queue).

### OpenAPI + AI

Every tRPC procedure exposes a REST path via `trpc-to-openapi`. External agents (or future Thread Agent) can read `/openapi.json` and call:

- `POST /api/queue/enqueue/email` — queue a send
- `POST /api/queue/approve` — approve after human review
- `POST /api/ai/inbox/rank` — rank threads by urgency (requires `OPENAI_API_KEY`)

The web app uses tRPC internally; OpenAPI is for tools, integrations, and AI function-calling.

## Environment

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres URL (Neon pooled URL for runtime) |
| `DATABASE_URL_UNPOOLED` | Neon direct URL for migrations (recommended) |
| `JWT_SECRET` | Min 16 chars |
| `JWT_REFRESH_SECRET` | Min 16 chars |
| `CLIENT_URL` | e.g. `http://localhost:3000` |
| `BASE_URL` | e.g. `http://localhost:8000` |

### Gmail + Calendar (Corsair)

| Variable | Description |
|----------|-------------|
| `CORSAIR_KEK` | Corsair encryption key |
| `GOOGLE_OAUTH_CLIENT_ID` / `SECRET` | Google Cloud OAuth |
| `CORSAIR_GMAIL_REDIRECT_URI` | Gmail OAuth callback |
| `CORSAIR_CALENDAR_REDIRECT_URI` | Calendar OAuth callback |

### Email (auth transactional)

| Variable | Description |
|----------|-------------|
| `BREVO_API_KEY` | Brevo API key |
| `EMAIL_FROM` | Verified sender |

### OpenAI (Priority inbox tab)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Enables **Priority** ranking in Inbox |
| `OPENAI_MODEL` | Optional, default `gpt-4o-mini` |

## Demo script (~2 min)

1. Sign up / sign in at http://localhost:3000
2. **Settings** → connect Gmail + Google Calendar
3. **Inbox** → open a thread → write reply → **Add to queue**
4. **Queue** → **Approve** → email sends via Gmail
5. **Inbox** → **Schedule meeting** → Queue → Approve → event on **Calendar**
6. **Calendar** → **Archive request** → **Queue** → confirm dates → **Proceed**
7. (Optional) Set `OPENAI_API_KEY` → Inbox **Priority** tab ranks urgent threads
8. Show judges **http://localhost:8000/docs** — live OpenAPI

## Scripts

```bash
pnpm dev              # web :3000 + api :8000
pnpm db:migrate       # Drizzle migrations
pnpm db:check         # test DB connection
pnpm test             # unit + integration tests
pnpm build            # production build
```

## Production notes

- Queue **approve** is atomic (`UPDATE … WHERE pending RETURNING`) — no double-send race
- Payloads re-validated with Zod at execute time
- Email headers sanitized against CRLF injection
- OpenAPI docs **off by default** in production (`PUBLIC_OPENAPI_DOCS=false`)
- Migrations versioned in `packages/database/drizzle/` (including `thread_queue_items` + Corsair tables)

## License

Private — Corsair Hackathon submission.
