# Thread — Judge Walkthrough (~3 minutes)

Live URLs:

| Service | URL |
|---------|-----|
| Web app | https://thread-web.vercel.app |
| **Scalar API docs** | https://thread-api.vercel.app/docs |
| OpenAPI JSON | https://thread-api.vercel.app/openapi.json |
| Thread MCP | `POST https://thread-api.vercel.app/mcp` |
| Official Corsair MCP | `POST https://thread-api.vercel.app/mcp/corsair` |
| Demo login | https://thread-web.vercel.app/api-auth/demo?next=/brief |

Full demo script: **`DEMO.md`**

---

## 1. Scalar docs (30s) — ★ Docs full marks

1. Open **https://thread-api.vercel.app/docs**
2. Read the **intro panel** — architecture diagram, Corsair API matrix, queue state machine, **57 MCP tools appendix**
3. Sidebar groups: **Corsair Gmail**, **Corsair Calendar**, **Approval queue**, **AI & Agent**, **MCP & Webhooks**
4. Expand **Queue → POST /queue/enqueue/email** — request examples + **curl code sample**
5. Expand **Inbox → GET /inbox/threads** — query param docs (`query`, `maxResults`)
6. Expand **MCP & Webhooks → POST /mcp** — JSON-RPC examples + curl
7. Expand **Health → GET /ready** — readiness probe documented
8. Try **GET /inbox/threads** after signing in (cookie auth)

> Full technical guide: **`DOCS.md`** · In dev: `http://localhost:8000/docs` — set `PUBLIC_OPENAPI_DOCS=true`.

---

## 2. Connect Corsair (30s)

1. Open https://thread-web.vercel.app/settings
2. **Connect Gmail** → Corsair OAuth
3. **Connect Calendar** → Corsair OAuth
4. Scalar docs reference these flows under **MCP & Webhooks → GET /api-connect/gmail**

---

## 3. Daily Brief (30s)

1. Open `/brief` — live Corsair Gmail + Calendar + OpenAI
2. Click an attention item → opens **Agent** with context

---

## 4. Agent + Queue (60s)

1. Open `/agent` — ask: *"What's urgent in my inbox? Draft a reply to the latest email."*
2. Open `/queue` — **Approve** the queued email
3. Scalar: **POST /queue/approve** example matches this flow

---

## 5. MCP curl (30s)

```bash
# List 57 tools (no auth)
curl -s -X POST https://thread-api.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 500

# Official Corsair MCP (requires auth)
curl -s -X POST https://thread-api.vercel.app/mcp/corsair \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_MCP_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_operations","arguments":{}}}'
```

---

## What judges should score

| Criterion | Evidence |
|-----------|----------|
| **Detailed docs** | Scalar at `/docs` — tag groups, examples, MCP/webhook reference |
| **Corsair Gmail** | `/inbox/*` + DB search + webhooks |
| **Corsair Calendar** | `/calendar/*` + quick-add queue + webhooks |
| **MCP** | 57 tools + official `/mcp/corsair` |
| **AI workflows** | Agent (57 tools) + Brief + Queue HITL |
| **Production hygiene** | Auth, CSRF, queue approval, OpenAPI from tRPC |
