# Thread API — Vercel deployment

Deploy **`apps/api`** as a separate Vercel project (e.g. `thread-api.vercel.app`).

## Required environment variables

| Variable | Example |
|----------|---------|
| `DATABASE_URL` | `postgresql://...@...neon.tech/neondb?sslmode=require` |
| `JWT_SECRET` | 32+ char random string |
| `JWT_REFRESH_SECRET` | 32+ char random string |
| `CORSAIR_KEK` | From Corsair dashboard |
| `CORSAIR_DEV_KEY` | From Corsair dashboard |
| `BASE_URL` | `https://thread-api.vercel.app` |
| `CLIENT_URL` | `https://thread-web.vercel.app` |
| `OPENAI_API_KEY` | For agent / brief / ranking |
| `WEBHOOKS_BASE_URL` | Same as `BASE_URL` |

Optional but recommended:

| Variable | Purpose |
|----------|---------|
| `CORSAIR_WEBHOOK_SECRET` | Gmail/Calendar webhooks |
| `CORSAIR_GMAIL_TOPIC_ID` | Gmail Pub/Sub push |
| `GOOGLE_OAUTH_CLIENT_ID` / `SECRET` | Corsair OAuth |
| `THREAD_MCP_API_KEY` + `THREAD_MCP_USER_ID` | Headless MCP |

`PUBLIC_OPENAPI_DOCS` defaults to **true** on `*.vercel.app` — `/docs` is public.

## Vercel project settings

| Setting | Value |
|---------|--------|
| **Root Directory** | `apps/api` |
| **Framework Preset** | Other |
| **Build Command** | (from `vercel.json`) `cd ../.. && pnpm --filter @repo/api build` |
| **Install Command** | `cd ../.. && pnpm install` |

## Verify after deploy

```bash
curl https://thread-api.vercel.app/health
curl https://thread-api.vercel.app/ready
curl https://thread-api.vercel.app/docs
```

If you get **503** with `Missing required environment variables`, add the listed vars in Vercel → Settings → Environment Variables → **Redeploy**.

## Web app (`thread-web`)

Set on the **web** Vercel project:

```
API_INTERNAL_URL=https://thread-api.vercel.app
```
