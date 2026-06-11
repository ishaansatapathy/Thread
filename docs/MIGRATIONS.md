# Database migrations

Thread uses **Drizzle Kit** for schema changes.

## Local development

```bash
pnpm db:migrate   # runs drizzle-kit migrate (packages/database/drizzle/*.sql)
pnpm db:seed      # optional demo data
```

Migration files live in `packages/database/drizzle/` and are tracked in `packages/database/drizzle/meta/_journal.json`.

## Production (Railway + Neon)

On API startup, `apps/api/src/migrate.ts`:

1. Runs **Drizzle journal migrations** (`runJournalMigrations` from `@repo/database/migrate`)
2. Applies **idempotent bootstrap SQL** for databases that predate migrations `0010–0013`

When you add a new migration:

1. Add `packages/database/drizzle/00XX_name.sql`
2. Register it in `packages/database/drizzle/meta/_journal.json`
3. Mirror critical changes in `ENSURE_SCHEMA_SQL` until bootstrap is retired

Run `pnpm db:migrate` against Neon before or during deploy so journal migrations apply cleanly.

## Current migrations

| Tag | Purpose |
|-----|---------|
| 0000–0009 | Core auth, forms, normalized responses, themes, indexes |
| 0010–0012 | Retention, multi-submit, require-auth |
| 0013 | Form versions, soft delete, idempotency |
| 0014 | User roles (`user` / `admin`) |
