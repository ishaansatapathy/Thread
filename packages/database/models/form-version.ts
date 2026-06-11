import { integer, jsonb, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { formsTable } from "./form";

export type FormVersionFieldSnapshot = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  config?: Record<string, unknown>;
};

export const formVersionsTable = pgTable(
  "form_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formId: uuid("form_id")
      .notNull()
      .references(() => formsTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    schemaSnapshot: jsonb("schema_snapshot").$type<FormVersionFieldSnapshot[]>().notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [unique("form_versions_form_version_unique").on(table.formId, table.versionNumber)],
);

export type SelectFormVersion = typeof formVersionsTable.$inferSelect;
export type InsertFormVersion = typeof formVersionsTable.$inferInsert;
