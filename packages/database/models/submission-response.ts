import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { uniqueIndex } from "drizzle-orm/pg-core";

import { submissionsTable } from "./submission";

export const submissionResponsesTable = pgTable("submission_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissionsTable.id, { onDelete: "cascade" }),
  // Intentionally not an FK to form_fields. Creators can edit/delete live fields;
  // historical normalized responses must survive those schema edits.
  fieldId: uuid("field_id").notNull(),
  value: text("value").notNull(),
}, (t) => ({
  submissionFieldUniqueIdx: uniqueIndex("submission_responses_submission_field_unique_idx")
    .on(t.submissionId, t.fieldId),
}));

export type SelectSubmissionResponse = typeof submissionResponsesTable.$inferSelect;
