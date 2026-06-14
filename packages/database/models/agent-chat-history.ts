import { pgTable, uuid, varchar, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const agentChatHistoryTable = pgTable(
  "agent_chat_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    messages: jsonb("messages").$type<Array<{ role: "user" | "assistant"; content: string }>>().notNull().default([]),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex("agent_chat_history_user_id_idx").on(t.userId),
  }),
);

export type SelectAgentChatHistory = typeof agentChatHistoryTable.$inferSelect;
export type InsertAgentChatHistory = typeof agentChatHistoryTable.$inferInsert;
