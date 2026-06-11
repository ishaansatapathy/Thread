import { boolean, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { usersTable } from "./user";

export const formVisibilityEnum = ["public", "unlisted", "draft"] as const;
export type FormVisibility = (typeof formVisibilityEnum)[number];

export const formThemeEnum = ["default", "ben10", "anime", "startup", "gaming", "tech"] as const;
export type FormTheme = (typeof formThemeEnum)[number];

export const formsTable = pgTable("forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  visibility: varchar("visibility", { length: 20 }).$type<FormVisibility>().default("public").notNull(),
  theme: varchar("theme", { length: 30 }).$type<FormTheme>().default("default").notNull(),
  slug: varchar("slug", { length: 80 }),
  viewCount: integer("view_count").default(0).notNull(),
  expiresAt: timestamp("expires_at"),
  allowMultipleSubmissions: boolean("allow_multiple_submissions").default(true).notNull(),
  requireAuthentication: boolean("require_authentication").default(false).notNull(),
  /** FK to form_versions.id — enforced in SQL migration 0013 */
  currentVersionId: uuid("current_version_id"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
}, (t) => ({
  visibilityCheck: check(
    "forms_visibility_check",
    sql`${t.visibility} in ('public', 'unlisted', 'draft')`,
  ),
  themeCheck: check(
    "forms_theme_check",
    sql`${t.theme} in ('default', 'ben10', 'anime', 'startup', 'gaming', 'tech')`,
  ),
}));

export type SelectForm = typeof formsTable.$inferSelect;
export type InsertForm = typeof formsTable.$inferInsert;
