import { index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

/** Files a user drops into Agent chat, held briefly until a queued Drive save runs. */
export const agentUploadsTable = pgTable(
  "agent_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 200 }).notNull(),
    size: integer("size").notNull(),
    dataBase64: text("data_base64").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index("agent_uploads_user_created_idx").on(t.userId, t.createdAt),
  }),
);

export type SelectAgentUpload = typeof agentUploadsTable.$inferSelect;
export type InsertAgentUpload = typeof agentUploadsTable.$inferInsert;
