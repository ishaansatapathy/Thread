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
| `DEMO_LOGIN_ENABLED` | `true` | Required on **API and web** for `/api-auth/demo` |
| `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD` | `demo@thread.dev` / `DemoPass123!` | Must match `pnpm db:seed` output |

Run seed once against prod DB:

```bash
DATABASE_URL="postgresql://..." pnpm db:seed
```

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

Build copies `dist/` → `api/dist/` (and `api/_bundle.js` fallback) so the serverless function finds bundled assets. If `/health` returns JSON the crash is fixed.

Dedicated **`api/health.js`** answers `/health` and `/ping` without loading the heavy bundle — use it to verify the Vercel project Root Directory (`apps/api`) is correct even during cold start.

If you get **503** with `Missing required environment variables`, add the listed vars in Vercel → Settings → Environment Variables → **Redeploy**.

If you get **500 `FUNCTION_INVOCATION_FAILED`** (opaque):

1. Open Vercel → **Deployments** → latest → **Functions** → `api/index.js` logs.
2. Confirm build output includes `dist/vercel.js`, `dist/server.js`, `dist/api-bootstrap.js`.
3. Confirm **Root Directory** is `apps/api` (not repo root).
4. Redeploy after setting env vars — cold start runs DB migrations automatically.

After a successful deploy, `/health` returns JSON (not HTML). Missing env returns **503** with a JSON list of vars.

## Web app (`thread-web`)

Set on the **web** Vercel project:

```
API_INTERNAL_URL=https://thread-api-smoky.vercel.app
DEMO_LOGIN_ENABLED=true
JWT_SECRET=<same as API>
JWT_REFRESH_SECRET=<same as API>
```

`API_INTERNAL_URL` must point to the **working** API project (not a broken deployment). Demo login calls `/api/authentication/demo-sign-in` on that host.
