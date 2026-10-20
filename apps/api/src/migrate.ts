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

-- Brief daily cache — one row per user per date.
CREATE TABLE IF NOT EXISTS brief_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key text NOT NULL,
  brief_json text NOT NULL,
  generated_at timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS brief_cache_user_date_idx ON brief_cache (user_id, date_key);

-- Queue kinds, including workspace_action (Drive / Sheets / Docs via HITL).
ALTER TABLE "thread_queue_items" DROP CONSTRAINT IF EXISTS "thread_queue_items_kind_check";
ALTER TABLE "thread_queue_items" ADD CONSTRAINT "thread_queue_items_kind_check" CHECK ("kind" IN ('email_send', 'email_draft', 'draft_send', 'calendar_invite', 'meeting_bundle', 'calendar_archive', 'calendar_delete', 'calendar_update', 'workspace_action'));

-- Files dropped into Agent chat, held until a queued Drive save runs.
CREATE TABLE IF NOT EXISTS agent_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename varchar(255) NOT NULL,
  mime_type varchar(200) NOT NULL,
  size integer NOT NULL,
  data_base64 text NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_uploads_user_created_idx ON agent_uploads (user_id, created_at);
`;

export async function runMigrations() {
  const databaseUrl = getMigrationDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  // Journal migrations may fail on existing DBs where tables were created
  // incrementally but the drizzle journal is out of sync. Never crash the
  // server for that — fall through to idempotent ENSURE_SCHEMA_SQL patches.
  try {
    await runJournalMigrations(databaseUrl);
  } catch (err) {
    console.warn(
      "[migrate] Drizzle journal migrations skipped:",
      err instanceof Error ? err.message : String(err),
    );
  }

  const client = await createPgClient(databaseUrl);
  try {
    await client.query(ENSURE_SCHEMA_SQL);
  } finally {
    await client.end();
  }
}
