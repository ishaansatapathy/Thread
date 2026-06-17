import { runJournalMigrations } from "@repo/database/migrate";
import { createPgClient, getMigrationDatabaseUrl } from "@repo/database/pg";

/**
 * Idempotent safety patches applied after journal migrations. Kept intentionally
 * small: only the auth columns Thread actually relies on. Schema for queues,
 * Corsair and the mail cache lives in versioned drizzle migrations.
 */
const ENSURE_SCHEMA_SQL = `
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar(20) DEFAULT 'user' NOT NULL;
ALTER TABLE "users" ALTER COLUMN "reset_password_otp" TYPE varchar(64);
ALTER TABLE "users" ALTER COLUMN "two_factor_otp" TYPE varchar(64);

-- Idempotent: create brief_dismissals if the drizzle journal migration hasn't run yet.
CREATE TABLE IF NOT EXISTS brief_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  dismissed_at timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS brief_dismissals_user_thread_idx ON brief_dismissals (user_id, thread_id);
`;

export async function runMigrations() {
  const databaseUrl = getMigrationDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  await runJournalMigrations(databaseUrl);

  const client = await createPgClient(databaseUrl);
  try {
    await client.query(ENSURE_SCHEMA_SQL);
  } finally {
    await client.end();
  }
}
