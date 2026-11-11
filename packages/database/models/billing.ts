import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

/** Where a request came from — lets us see how much the Chrome extension is used. */
export const usageSourceEnum = ["web", "extension"] as const;
export type UsageSource = (typeof usageSourceEnum)[number];

/** One row per paid-for or metered action (an agent message, a read-aloud, a dub...). Always written. */
export const usageEventsTable = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    source: text("source").notNull().$type<UsageSource>(),
    /** e.g. "agent_message", "speak", "translate_speak", "catch_up", "dub" */
    feature: text("feature").notNull(),
    /** Credits this action costs (charged only while billing is enforced). */
    credits: integer("credits").notNull().default(0),
    /** True when the credits were actually deducted from the wallet. */
    charged: integer("charged").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index("usage_events_user_created_idx").on(t.userId, t.createdAt),
    createdIdx: index("usage_events_created_idx").on(t.createdAt),
  }),
);

/** A user's current credit balance. Updated only with atomic statements, never read-modify-write. */
export const creditWalletsTable = pgTable("credit_wallets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const creditTransactionKindEnum = ["grant", "purchase", "spend", "refund"] as const;
export type CreditTransactionKind = (typeof creditTransactionKindEnum)[number];

/** The wallet's history: every change to the balance, with the balance it left behind. */
export const creditTransactionsTable = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<CreditTransactionKind>(),
    /** Positive adds credits, negative spends them. */
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    /** What it was for: a feature name, a pack name, or "signup". */
    note: text("note"),
    /** Razorpay payment id for purchases — unique, so a payment can never be credited twice. */
    paymentId: text("payment_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index("credit_transactions_user_created_idx").on(t.userId, t.createdAt),
    paymentIdx: uniqueIndex("credit_transactions_payment_idx").on(t.paymentId),
  }),
);

export const paymentStatusEnum = ["created", "paid", "failed"] as const;
export type PaymentStatus = (typeof paymentStatusEnum)[number];

/** A Razorpay order for one credit pack. */
export const paymentsTable = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    razorpayOrderId: text("razorpay_order_id").notNull(),
    razorpayPaymentId: text("razorpay_payment_id"),
    packId: text("pack_id").notNull(),
    /** Amount in paise (₹1 = 100). */
    amount: integer("amount").notNull(),
    credits: integer("credits").notNull(),
    status: text("status").notNull().$type<PaymentStatus>().default("created"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    paidAt: timestamp("paid_at"),
  },
  (t) => ({
    orderIdx: uniqueIndex("payments_order_idx").on(t.razorpayOrderId),
    userIdx: index("payments_user_idx").on(t.userId, t.createdAt),
  }),
);

export type SelectCreditWallet = typeof creditWalletsTable.$inferSelect;
export type SelectPayment = typeof paymentsTable.$inferSelect;
