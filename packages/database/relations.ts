import { relations } from "drizzle-orm";

import { formFieldsTable } from "./models/form-field";
import { formVersionsTable } from "./models/form-version";
import { formsTable } from "./models/form";
import { submissionsTable } from "./models/submission";
import { submissionAuditEventsTable } from "./models/submission-audit-event";
import { submissionResponsesTable } from "./models/submission-response";
import { threadQueueItemsTable } from "./models/queue-item";
import { usersTable } from "./models/user";

export const usersRelations = relations(usersTable, ({ many }) => ({
  forms: many(formsTable),
  queueItems: many(threadQueueItemsTable),
}));

export const formsRelations = relations(formsTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [formsTable.userId],
    references: [usersTable.id],
  }),
  currentVersion: one(formVersionsTable, {
    fields: [formsTable.currentVersionId],
    references: [formVersionsTable.id],
  }),
  fields: many(formFieldsTable),
  submissions: many(submissionsTable),
  versions: many(formVersionsTable),
  submissionAuditEvents: many(submissionAuditEventsTable),
}));

export const formVersionsRelations = relations(formVersionsTable, ({ one, many }) => ({
  form: one(formsTable, {
    fields: [formVersionsTable.formId],
    references: [formsTable.id],
  }),
  submissions: many(submissionsTable),
}));

export const formFieldsRelations = relations(formFieldsTable, ({ one, many }) => ({
  form: one(formsTable, {
    fields: [formFieldsTable.formId],
    references: [formsTable.id],
  }),
  responses: many(submissionResponsesTable),
}));

export const submissionsRelations = relations(submissionsTable, ({ one, many }) => ({
  form: one(formsTable, {
    fields: [submissionsTable.formId],
    references: [formsTable.id],
  }),
  formVersion: one(formVersionsTable, {
    fields: [submissionsTable.formVersionId],
    references: [formVersionsTable.id],
  }),
  responses: many(submissionResponsesTable),
}));

export const submissionResponsesRelations = relations(submissionResponsesTable, ({ one }) => ({
  submission: one(submissionsTable, {
    fields: [submissionResponsesTable.submissionId],
    references: [submissionsTable.id],
  }),
  field: one(formFieldsTable, {
    fields: [submissionResponsesTable.fieldId],
    references: [formFieldsTable.id],
  }),
}));

export const submissionAuditEventsRelations = relations(submissionAuditEventsTable, ({ one }) => ({
  form: one(formsTable, {
    fields: [submissionAuditEventsTable.formId],
    references: [formsTable.id],
  }),
  actor: one(usersTable, {
    fields: [submissionAuditEventsTable.actorUserId],
    references: [usersTable.id],
  }),
}));

export const threadQueueItemsRelations = relations(threadQueueItemsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [threadQueueItemsTable.userId],
    references: [usersTable.id],
  }),
}));
