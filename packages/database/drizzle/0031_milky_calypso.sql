CREATE TABLE "thread_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(200) NOT NULL,
	"preview" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_thread_id" varchar(128),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"processing_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	CONSTRAINT "thread_queue_items_kind_check" CHECK ("thread_queue_items"."kind" in ('email_send', 'email_draft', 'calendar_invite', 'meeting_bundle', 'calendar_archive', 'calendar_delete')),
	CONSTRAINT "thread_queue_items_status_check" CHECK ("thread_queue_items"."status" in ('pending', 'processing', 'approved', 'dismissed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "thread_mail_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"thread_id" varchar(128) NOT NULL,
	"history_id" varchar(64),
	"subject" text,
	"from_name" text,
	"from_address" varchar(320),
	"snippet" text,
	"last_message_at" timestamp,
	"message_count" integer DEFAULT 1 NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120),
	"handle" varchar(80) NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_chat_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "brief_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"dismissed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_gmail_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"history_id" varchar(64),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "thread_calendar_state" (
	"user_id" varchar(64) PRIMARY KEY NOT NULL,
	"channel_id" varchar(256) NOT NULL,
	"resource_id" varchar(256),
	"expiration" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" varchar(80);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" varchar(20) DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verification_token" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verification_token_expire" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_password_token" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_password_otp" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_password_expire" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_otp" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_otp_expire" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" varchar(20) DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" varchar(20) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_approve_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_approve_agent_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_approve_calendar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_queue_items" ADD CONSTRAINT "thread_queue_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_contacts" ADD CONSTRAINT "thread_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_history" ADD CONSTRAINT "agent_chat_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_dismissals" ADD CONSTRAINT "brief_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_gmail_state" ADD CONSTRAINT "thread_gmail_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_mail_cache_user_thread_unique" ON "thread_mail_cache" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE INDEX "thread_mail_cache_user_recent_idx" ON "thread_mail_cache" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_contacts_user_email_unique" ON "thread_contacts" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "thread_contacts_user_handle_idx" ON "thread_contacts" USING btree ("user_id","handle");--> statement-breakpoint
CREATE INDEX "thread_contacts_user_last_used_idx" ON "thread_contacts" USING btree ("user_id","last_used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_chat_history_user_id_idx" ON "agent_chat_history" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brief_dismissals_user_thread_idx" ON "brief_dismissals" USING btree ("user_id","thread_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_provider_check" CHECK ("users"."auth_provider" in ('local', 'google'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('user', 'admin'));