ALTER TABLE "thread_queue_items" DROP CONSTRAINT IF EXISTS "thread_queue_items_kind_check";

ALTER TABLE "thread_queue_items" ADD CONSTRAINT "thread_queue_items_kind_check" CHECK ("kind" IN ('email_send', 'email_draft', 'draft_send', 'calendar_invite', 'meeting_bundle', 'calendar_archive', 'calendar_delete', 'calendar_update', 'workspace_action'));

CREATE TABLE IF NOT EXISTS "agent_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "filename" varchar(255) NOT NULL,
  "mime_type" varchar(200) NOT NULL,
  "size" integer NOT NULL,
  "data_base64" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_uploads_user_created_idx" ON "agent_uploads" ("user_id", "created_at");
