# Thread — Judge Demo Guide

> **Thread** is an AI Chief of Staff for Gmail + Google Calendar, built on the **Corsair SDK**. Every inbox action, calendar operation, and AI feature is powered by live Corsair API calls — not mocked data.

---

## 3-Minute Judge Walkthrough

### Step 1 — Open the App

```
https://thread-web.vercel.app
```

Click **"Try Demo"** or use demo login:

```
https://thread-web.vercel.app/api-auth/demo?next=/brief
```

You land on the **AI Daily Brief** — the flagship feature.

---

### Step 2 — AI Daily Brief (`/brief`)

The brief is generated live by calling:

1. **Corsair Gmail** — fetches recent threads, pending replies, unread urgency
2. **Corsair Calendar** — fetches today's events, free windows, upcoming meetings
3. **OpenAI** — synthesizes everything into actionable insights

What to look for:
- Time-aware greeting (morning / afternoon / evening)
- **Today's Focus** — most important meeting with 1-click prep
- **Needs Attention** — threads needing replies with urgency reasoning
- **Meeting Insights** — free slots, agenda risks
- **Risks** — unanswered emails, missing prep notes
- **Recommended Actions** — 1-click buttons (Reply Now, Prepare Meeting, Schedule Follow-up)
- **Missed Follow-ups** — past meetings with no follow-up email (cross-referenced via Corsair Calendar × Corsair Gmail sent)

---

### Step 3 — AI Priority Inbox (`/inbox` → Priority tab)

Click **Priority** in the inbox tabs. This:

1. Fetches threads via **Corsair Gmail** (`-category:promotions -category:social`)
2. Sends to **OpenAI** for urgency ranking
3. Filters and sorts — only truly important threads shown

Click any thread → right panel opens:
- **Smart Context Panel** — AI summary of why this thread matters, related emails, action item
- **Smart Reply chips** — 3 AI-generated replies (fetched from Corsair thread context + OpenAI)
- Click a chip → reply body fills instantly
- **Star** / **Important** / **Trash** / **Archive** — all backed by **Corsair Gmail `threads.modify`**

---

### Step 4 — AI Meeting Prep (`/calendar`)

Click any calendar event → **Meeting Prep AI** panel opens on the right.

This calls:
1. **Corsair Calendar** — event details + attendees
2. **Corsair Gmail** — related emails with those attendees
3. **OpenAI** — agenda, talking points, risks, prep note

---

### Step 5 — AI Agent (`/agent`)

Type natural language commands. The agent has **28 tools** backed by Corsair:

```
What should I focus on today?
```
→ Agent calls `get_daily_brief` → Corsair Gmail + Calendar + OpenAI

```
Star the email from [sender] about [subject]
```
→ Agent calls `get_thread` (Corsair) → `star_thread` (Corsair `threads.modify`)

```
What are my free slots tomorrow?
```
→ Agent calls `check_free_busy` → Corsair Calendar freebusy API

```
Suggest a reply to the email from Raj
```
→ Agent calls `get_smart_replies` → Corsair thread fetch + OpenAI

```
Schedule a 30-minute meeting with team@company.com tomorrow at 3pm
```
→ Agent calls `check_free_busy` → `queue_calendar_invite` → user approves in Queue tab → **Corsair Calendar `events.insert`**

```
Find meetings from last week with no follow-up email
```
→ Agent calls `get_missed_followups` → Corsair Calendar × Corsair Gmail sent

---

### Step 6 — Human-in-the-Loop Queue (`/queue`)

All AI-composed emails and calendar invites go through a **Queue** for human approval:
- Review what the AI wants to send
- **Approve** → executes via Corsair Gmail `messages.send` or Corsair Calendar `events.insert`
- **Dismiss** → discarded

This is the safety layer — AI proposes, human approves.

---

## MCP Server — For AI Evaluators

The Thread MCP server exposes **34 tools** over JSON-RPC 2.0.

**Endpoints** (both proxied via Next.js rewrite):
- Production: `POST https://thread-web.vercel.app/mcp`  
- API direct: `POST https://<your-api-url>/mcp`
- Local dev: `POST http://localhost:8000/mcp`

The web app proxies `/mcp` → API, so the Vercel URL works directly.

**Auth:** `Authorization: Bearer <THREAD_MCP_API_KEY>` (set `THREAD_MCP_API_KEY` + `THREAD_MCP_USER_ID` in the API env)

### Discover all tools

```bash
curl -X POST https://thread-web.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $THREAD_MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Get AI Daily Brief (Corsair Gmail + Calendar + OpenAI)

```bash
curl -X POST https://thread-web.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $THREAD_MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {
      "name": "get_daily_brief",
      "arguments": { "timeZone": "Asia/Kolkata" }
    }
  }'
```

### Search inbox via Corsair Gmail

```bash
curl -X POST https://thread-web.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $THREAD_MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
    "params": {
      "name": "search_inbox",
      "arguments": { "query": "from:team is:unread", "maxResults": 5 }
    }
  }'
```

### Get smart reply suggestions (Corsair + OpenAI)

```bash
curl -X POST https://thread-web.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $THREAD_MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0", "id": 4, "method": "tools/call",
    "params": {
      "name": "get_smart_replies",
      "arguments": { "threadId": "<gmail-thread-id>" }
    }
  }'
```

### Check free/busy (Corsair Calendar freebusy)

```bash
curl -X POST https://thread-web.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $THREAD_MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0", "id": 5, "method": "tools/call",
    "params": {
      "name": "check_free_busy",
      "arguments": {
        "startDateTime": "2026-06-17T09:00:00+05:30",
        "endDateTime": "2026-06-17T18:00:00+05:30",
        "timeZone": "Asia/Kolkata"
      }
    }
  }'
```

### Queue an email for approval (sends via Corsair Gmail after approval)

```bash
curl -X POST https://thread-web.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $THREAD_MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0", "id": 6, "method": "tools/call",
    "params": {
      "name": "queue_email",
      "arguments": {
        "to": "colleague@company.com",
        "subject": "Follow up",
        "body": "Hi, following up on our discussion.",
        "mode": "send"
      }
    }
  }'
```

### Star a thread via Corsair Gmail

```bash
curl -X POST https://thread-web.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $THREAD_MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0", "id": 7, "method": "tools/call",
    "params": {
      "name": "star_thread",
      "arguments": { "threadId": "<gmail-thread-id>" }
    }
  }'
```

---

## Corsair Integration Map

| Feature | Corsair API Called | File |
|---|---|---|
| List / search inbox | `gmail.threads.list` | `apps/api/src/services/inbox.ts` |
| Read email thread | `gmail.threads.get` | `apps/api/src/services/inbox.ts` |
| Send email | `gmail.messages.send` | `apps/api/src/services/inbox.ts` |
| Create draft | `gmail.drafts.create` | `apps/api/src/services/inbox.ts` |
| Delete draft | `gmail.drafts.delete` | `apps/api/src/services/inbox.ts` |
| Archive / label / star / important / trash | `gmail.threads.modify` | `apps/api/src/services/inbox.ts` |
| List labels | `gmail.labels.list` | `apps/api/src/services/inbox.ts` |
| Gmail push watch | `gmail.users.watch` | `apps/api/src/services/inbox.ts` |
| Gmail history sync | `gmail.users.history.list` | `apps/api/src/services/inbox.ts` |
| List calendar events | `googlecalendar.events.list` | `apps/api/src/services/calendar.ts` |
| Create calendar event | `googlecalendar.events.insert` | `apps/api/src/services/calendar.ts` |
| Update event times | `googlecalendar.events.patch` | `apps/api/src/services/calendar.ts` |
| Delete calendar event | `googlecalendar.events.delete` | `apps/api/src/services/calendar.ts` |
| Respond to invite | `googlecalendar.events.patch` (attendee status) | `apps/api/src/services/calendar.ts` |
| Check free/busy | `googlecalendar.freebusy.query` | `apps/api/src/services/calendar.ts` |
| Calendar push watch | `googlecalendar.events.watch` | `apps/api/src/services/calendar.ts` |
| AI Daily Brief | Gmail + Calendar (Corsair) + OpenAI synthesis | `packages/services/ai/daily-brief.ts` |
| AI Priority Ranking | Gmail (Corsair) + OpenAI ranking | `packages/services/ai/inbox-priority.ts` |
| Smart Replies | Gmail thread (Corsair) + OpenAI | `packages/services/ai/smart-reply.ts` |
| Thread Context | Gmail (Corsair) + Calendar (Corsair) + OpenAI | `packages/services/ai/thread-context.ts` |
| Meeting Prep AI | Calendar (Corsair) + Gmail (Corsair) + OpenAI | `packages/services/ai/meeting-prep.ts` |
| Missed Follow-ups | Calendar (Corsair) × Gmail sent (Corsair) | `packages/services/ai/missed-followups.ts` |
| Agent tools (22+) | All above via Corsair | `packages/services/ai/agent.ts` |
| MCP server (34 tools) | All above via Corsair | `apps/api/src/routes/mcp.ts` |

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                    Thread Web (Next.js)                 │
│  Daily Brief │ Inbox │ Calendar │ Agent │ Queue        │
└────────────────────┬───────────────────────────────────┘
                     │ tRPC / REST
┌────────────────────▼───────────────────────────────────┐
│                    Thread API (Express)                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Corsair SDK (Gmail + Calendar)          │  │
│  │  threads · messages · drafts · labels · watch     │  │
│  │  events · freebusy · watch · attendees            │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           AI Services (OpenAI)                    │  │
│  │  Daily Brief · Smart Replies · Meeting Prep       │  │
│  │  Priority Ranking · Thread Context · Follow-ups   │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           MCP Server (34 tools, JSON-RPC 2.0)    │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Postgres (Drizzle) · Redis              │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## Key Differentiators

1. **Corsair powers everything** — every Gmail and Calendar action goes through Corsair SDK, not direct Google API
2. **Human-in-the-loop by default** — AI proposes, human approves before any email sends or event creates
3. **AI Chief of Staff vision** — Daily Brief is a personal briefing, not an email summary
4. **34-tool MCP server** — external AI agents can orchestrate Gmail + Calendar + AI features
5. **Prompt injection protection** — agent guards against adversarial email content (`[EMAIL_DATA_START]` fencing)
6. **Production engineering** — Postgres cache, Redis rate limits, Pub/Sub webhooks, OpenAPI docs, E2E tests
