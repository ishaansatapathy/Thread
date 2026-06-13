# Thread — Corsair Hackathon

**Thread** is a Gmail + Google Calendar workflow app with a human-in-the-loop **approval queue**. Nothing sends or schedules until you approve it in Queue.

Built for the Corsair Hackathon using the **Corsair SDK** (Gmail + Calendar), **tRPC**, **OpenAPI REST**, **Drizzle/Postgres**, and optional **OpenAI** for inbox priority ranking.

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

### Gmail workflow

- **Search** — full Gmail query syntax (`from:`, `subject:`, `has:attachment`) via the `query` param; press `/` to focus the box.
- **Load more** — token-based pagination accumulates pages (no 25-thread cap).
- **Rich list metadata** — each row is hydrated with sender, subject, date, message count and unread state via a cheap `threads.get(metadata)` enrichment pass.
- **Drafts** — a Drafts tab lists Gmail drafts (subject/recipient/snippet).
- **Local mail cache** — thread metadata in Postgres (`thread_mail_cache`). Unchanged threads skip re-fetch when `historyId` matches; search falls back to cache when Gmail is unreachable.
- **Webhooks** — `POST /webhooks/gmail` and `/webhooks/calendar` verify a shared secret, then refresh inbox cache / calendar range. Set `CORSAIR_WEBHOOK_SECRET` to enable.
- **Keyboard** — `j`/`k` move selection, `/` focuses search, `⌘K` opens the command palette.

### OpenAPI + AI

Every tRPC procedure exposes a REST path via `trpc-to-openapi`. External agents (or future Thread Agent) can read `/openapi.json` and call:

- `GET /api/inbox/threads?query=from:boss` — search + paginate the inbox
- `GET /api/inbox/drafts` — list Gmail drafts
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

### Turnstile (bot protection)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (widget on sign-in / sign-up) |
| `TURNSTILE_SECRET_KEY` | Turnstile secret for server-side verification |

Both unset = Turnstile disabled (fine for local dev). In production, set both and add your domain plus `localhost` in the Turnstile dashboard hostnames.

### OpenAI (Priority inbox tab)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Enables **Priority** ranking in Inbox |
| `OPENAI_MODEL` | Optional, default `gpt-4o-mini` |

### Webhooks (optional)

| Variable | Description |
|----------|-------------|
| `CORSAIR_WEBHOOK_SECRET` | Min 16 chars. Enables `POST /webhooks/gmail` + `/webhooks/calendar`. Unset = receiver returns 503 and Thread uses on-demand sync. |

## Demo script (~2 min)

1. Sign up / sign in at http://localhost:3000
2. **Settings** → connect Gmail + Google Calendar
3. **Inbox** → search (`/`), `j`/`k` to navigate, **Load more** to page
4. Open a thread → write reply → **Add to queue**
5. **Queue** → **Approve** → email sends via Gmail
6. **Inbox** → **Schedule meeting** → Queue → Approve → event on **Calendar**
7. **Calendar** → recurring events show a ↻ badge → **Reschedule** or **Delete** (both queue-first) → approve in **Queue**
8. (Optional) Set `OPENAI_API_KEY` → Inbox **Priority** tab ranks urgent threads
9. Show judges **http://localhost:8000/docs** — live OpenAPI

### Webhook wiring (optional, production)

1. Set `CORSAIR_WEBHOOK_SECRET` in `.env` (min 16 chars).
2. Point Google Pub/Sub (Gmail) or your push proxy at `POST https://<api-host>/webhooks/gmail` with header `x-corsair-webhook-secret: <secret>`.
3. Calendar pushes can use `POST /webhooks/calendar` with the same secret (body may include `tenantId` or Pub/Sub `emailAddress`).
4. Thread ACKs immediately and refreshes cache in the background — no slow handler required.

## Scripts

```bash
pnpm dev              # web :3000 + api :8000
pnpm db:migrate       # Drizzle migrations
pnpm db:check         # test DB connection
pnpm test             # unit + integration tests
pnpm --filter web test:e2e:install   # one-time: install Playwright chromium
pnpm --filter web test:e2e           # Playwright smoke E2E (landing, auth gate)
pnpm build            # production build
```

## Production notes

- Queue **approve** is atomic (`UPDATE … WHERE pending RETURNING`) — no double-send race
- Payloads re-validated with Zod at execute time
- Email headers sanitized against CRLF injection
- OpenAPI docs **off by default** in production (`PUBLIC_OPENAPI_DOCS=false`)
- Migrations versioned in `packages/database/drizzle/` (queue, Corsair, `thread_mail_cache`); legacy form-builder tables dropped in `0022`
- Webhook receiver verifies a shared secret with a constant-time comparison and ACKs fast (refresh runs detached)
- Mail-cache writes are best-effort — cache failures never break the live inbox
- Calendar **delete** and **reschedule** are queue-first (same human-in-the-loop as email)
- E2E smoke tests in `apps/web/e2e` (Playwright) cover the public surface and the auth gate

## License

Private — Corsair Hackathon submission.
