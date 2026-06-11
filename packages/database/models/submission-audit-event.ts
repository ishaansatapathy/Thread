import { jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { formsTable } from "./form";
import { usersTable } from "./user";

export type SubmissionAuditSnapshot = {
  submissionId: string;
  formVersionId: string | null;
  submittedAt: string | null;
  answers: Array<{
    fieldId: string;
    label: string;
    type: string;
    value: string;
  }>;
};

export const submissionAuditEventsTable = pgTable("submission_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: varchar("event_type", { length: 40 }).notNull(),
  formId: uuid("form_id")
    .notNull()
    .references(() => formsTable.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").notNull(),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  snapshot: jsonb("snapshot").$type<SubmissionAuditSnapshot>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SelectSubmissionAuditEvent = typeof submissionAuditEventsTable.$inferSelect;
export type InsertSubmissionAuditEvent = typeof submissionAuditEventsTable.$inferInsert;
