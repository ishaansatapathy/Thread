import { relations } from "drizzle-orm";

import { threadQueueItemsTable } from "./models/queue-item";
import { usersTable } from "./models/user";

export const usersRelations = relations(usersTable, ({ many }) => ({
  queueItems: many(threadQueueItemsTable),
}));

export const threadQueueItemsRelations = relations(threadQueueItemsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [threadQueueItemsTable.userId],
    references: [usersTable.id],
  }),
}));
