# Thread — Corsair Hackathon

Monorepo for **Thread**: a Gmail + Calendar workflow product. Right now the repo is intentionally slim — landing page + shared infrastructure skeleton. Features get added one by one.

## Project structure

```
corsair-hackathon/
├── apps/
│   ├── api/          # Express + tRPC + OpenAPI (health only for now)
│   └── web/          # Next.js 16 — Thread marketing landing
│       ├── app/      # `/` landing
│       ├── components/thread/
│       └── trpc/     # Client proxy wiring (ready for domain routes)
├── packages/
│   ├── database/     # Drizzle schema + migrations (legacy tables kept for now)
│   ├── services/     # Auth/user stubs — extend as Thread ships
│   ├── trpc/         # Shared tRPC router (health only)
│   ├── logger/
│   ├── eslint-config/
│   └── typescript-config/
├── turbo.json
└── pnpm-workspace.yaml
```

## Dev

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:8000

## What ships today

- Thread landing (hero, process flow, sections, FAQ)
- API health + readiness endpoints
- tRPC/OpenAPI scaffold

## Building next

Add features incrementally: Gmail inbox, calendar, agent chat, etc.
