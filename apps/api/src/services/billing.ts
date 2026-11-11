/**
 * Credits and payments.
 *
 * Users pay-as-they-go: they buy credit packs with Razorpay and features spend credits. Every
 * metered action is written to `usage_events` (with whether it came from the web app or the Chrome
 * extension) even while billing is switched off, so usage is visible before anyone is charged.
 *
 * Billing is OFF until BILLING_ENFORCED=1: nothing is deducted and nothing is blocked.
 * Razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { Request, Response } from "express";

import db, { and, desc, eq, gte, sql } from "@repo/database";
import {
  creditTransactionsTable,
  creditWalletsTable,
  paymentsTable,
  usageEventsTable,
  usersTable,
  type UsageSource,
} from "@repo/database/schema";
import { logger } from "@repo/logger";
import { serviceError } from "@repo/services/errors";

export type Feature = "agent_message" | "speak" | "translate_speak" | "catch_up" | "dub" | "dictation" | "live_dub";

/**
 * What each action costs, in credits. One place to tune pricing. Actions with cost 0 are only
 * logged, not charged.
 */
export const CREDIT_COSTS = {
  agentMessage: 1,
  /** Per started 1,000 characters read aloud. */
  speakPer1000Chars: 1,
  translateSpeak: 1,
  catchUp: 2,
  /** Per started minute of meeting audio dubbed. */
  dubPerMinute: 10,
} as const;

export type CreditPack = { id: string; name: string; credits: number; amountPaise: number; blurb: string };

export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", name: "Starter", credits: 100, amountPaise: 9_900, blurb: "Try voice, dubbing and the agent" },
  { id: "plus", name: "Plus", credits: 350, amountPaise: 29_900, blurb: "For regular daily use" },
  { id: "pro", name: "Pro", credits: 1000, amountPaise: 79_900, blurb: "Best value for heavy users" },
];

export const STARTER_CREDITS = Math.max(0, Number(process.env.BILLING_STARTER_CREDITS ?? 50) || 0);

export const billingEnforced = () => process.env.BILLING_ENFORCED === "1";

/** A request from the Chrome extension carries a bearer token and no cookies. */
export function usageSource(req: Request): UsageSource {
  const bearer = /^Bearer\s+\S+$/.test(String(req.headers.authorization ?? ""));
  return bearer && !req.headers.cookie ? "extension" : "web";
}

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly needed: number,
    public readonly balance: number,
  ) {
    super(`Not enough credits: this needs ${needed}, you have ${balance}. Top up in Thread → Credits.`);
    this.name = "InsufficientCreditsError";
  }
}

/** Answers 402 when a request ran out of credits. Returns true if it handled the error. */
export function respondIfOutOfCredits(res: Response, error: unknown): boolean {
  if (!(error instanceof InsufficientCreditsError)) return false;
  res.status(402).json({ error: error.message, code: "insufficient_credits", needed: error.needed, balance: error.balance });
  return true;
}

/** Creates the wallet on first use, with the free starter credits. Returns the current balance. */
export async function ensureWallet(userId: string): Promise<number> {
  const inserted = await db
    .insert(creditWalletsTable)
    .values({ userId, balance: STARTER_CREDITS })
    .onConflictDoNothing()
    .returning({ balance: creditWalletsTable.balance });
  if (inserted.length > 0) {
    if (STARTER_CREDITS > 0) {
      await db.insert(creditTransactionsTable).values({
        userId,
        kind: "grant",
        delta: STARTER_CREDITS,
        balanceAfter: STARTER_CREDITS,
        note: "Welcome credits",
      });
    }
    return inserted[0]!.balance;
  }
  const [row] = await db.select({ balance: creditWalletsTable.balance }).from(creditWalletsTable).where(eq(creditWalletsTable.userId, userId));
  return row?.balance ?? 0;
}

async function logUsage(userId: string, source: UsageSource, feature: Feature, credits: number, charged: boolean) {
  try {
    await db.insert(usageEventsTable).values({ userId, source, feature, credits, charged: charged ? 1 : 0 });
  } catch (error) {
    // Metering must never break the feature itself.
    logger.warn("billing.usage_log_failed", { feature, message: error instanceof Error ? error.message : String(error) });
  }
}

/** Takes `credits` from the wallet atomically; throws InsufficientCreditsError when there aren't enough. */
async function deduct(userId: string, credits: number, note: string) {
  await ensureWallet(userId);
  const updated = await db
    .update(creditWalletsTable)
    .set({ balance: sql`${creditWalletsTable.balance} - ${credits}`, updatedAt: new Date() })
    .where(and(eq(creditWalletsTable.userId, userId), gte(creditWalletsTable.balance, credits)))
    .returning({ balance: creditWalletsTable.balance });
  if (updated.length === 0) {
    const balance = await ensureWallet(userId);
    throw new InsufficientCreditsError(credits, balance);
  }
  await db.insert(creditTransactionsTable).values({ userId, kind: "spend", delta: -credits, balanceAfter: updated[0]!.balance, note });
}

async function refund(userId: string, credits: number, note: string) {
  const updated = await db
    .update(creditWalletsTable)
    .set({ balance: sql`${creditWalletsTable.balance} + ${credits}`, updatedAt: new Date() })
    .where(eq(creditWalletsTable.userId, userId))
    .returning({ balance: creditWalletsTable.balance });
  if (updated[0]) {
    await db.insert(creditTransactionsTable).values({ userId, kind: "refund", delta: credits, balanceAfter: updated[0].balance, note });
  }
}

/**
 * Runs `work` as a metered action. While billing is enforced the credits are taken first (so two
 * simultaneous requests can't both spend the last credit) and given back if the work throws.
 * Always writes a usage event.
 */
export async function metered<T>(
  ctx: { userId: string; source: UsageSource; feature: Feature },
  credits: number,
  work: () => Promise<T>,
): Promise<T> {
  const charge = billingEnforced() && credits > 0;
  if (charge) await deduct(ctx.userId, credits, ctx.feature);
  try {
    const result = await work();
    await logUsage(ctx.userId, ctx.source, ctx.feature, credits, charge);
    return result;
  } catch (error) {
    if (charge) await refund(ctx.userId, credits, `${ctx.feature} failed`).catch(() => undefined);
    throw error;
  }
}

/** Same as `metered` for streaming work that is started and finished elsewhere: charge now, you handle refunds. */
export async function chargeUpfront(ctx: { userId: string; source: UsageSource; feature: Feature }, credits: number) {
  const charge = billingEnforced() && credits > 0;
  if (charge) await deduct(ctx.userId, credits, ctx.feature);
  await logUsage(ctx.userId, ctx.source, ctx.feature, credits, charge);
  return { refund: () => (charge ? refund(ctx.userId, credits, `${ctx.feature} failed`) : Promise.resolve()) };
}

/** Records usage without charging (e.g. dictation clips, live dub lines). */
export function recordUsage(ctx: { userId: string; source: UsageSource; feature: Feature }) {
  return logUsage(ctx.userId, ctx.source, ctx.feature, 0, false);
}

export const speakCost = (chars: number) => Math.max(1, Math.ceil(chars / 1000)) * CREDIT_COSTS.speakPer1000Chars;
export const dubCost = (audioSeconds: number) => Math.max(1, Math.ceil(audioSeconds / 60)) * CREDIT_COSTS.dubPerMinute;

export async function getBillingSummary(userId: string) {
  const balance = await ensureWallet(userId);
  const [transactions, payments] = await Promise.all([
    db.select().from(creditTransactionsTable).where(eq(creditTransactionsTable.userId, userId)).orderBy(desc(creditTransactionsTable.createdAt)).limit(30),
    db.select().from(paymentsTable).where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.status, "paid"))).orderBy(desc(paymentsTable.createdAt)).limit(10),
  ]);
  return {
    balance,
    enforced: billingEnforced(),
    paymentsEnabled: razorpayConfigured(),
    packs: CREDIT_PACKS,
    costs: CREDIT_COSTS,
    transactions: transactions.map((t) => ({ id: t.id, kind: t.kind, delta: t.delta, balanceAfter: t.balanceAfter, note: t.note, createdAt: t.createdAt })),
    payments: payments.map((p) => ({ id: p.id, packId: p.packId, amount: p.amount, credits: p.credits, paidAt: p.paidAt })),
  };
}

// ── Razorpay ─────────────────────────────────────────────────────────────────

const razorpayKeys = () => ({
  keyId: process.env.RAZORPAY_KEY_ID?.trim() ?? "",
  keySecret: process.env.RAZORPAY_KEY_SECRET?.trim() ?? "",
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "",
});

export const razorpayConfigured = () => {
  const { keyId, keySecret } = razorpayKeys();
  return Boolean(keyId && keySecret);
};

export const razorpayKeyId = () => razorpayKeys().keyId;

function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The signature Razorpay Checkout returns after a successful payment. */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const { keySecret } = razorpayKeys();
  if (!keySecret) return false;
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Razorpay signs the raw webhook body with the webhook secret. */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string) {
  const { webhookSecret } = razorpayKeys();
  if (!webhookSecret || !signature) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

export async function createOrder(userId: string, packId: string) {
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) throw serviceError("BAD_REQUEST", "Pick a credit pack.");
  if (!razorpayConfigured()) throw serviceError("PRECONDITION_FAILED", "Payments aren't set up yet.");
  const { keyId, keySecret } = razorpayKeys();

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: pack.amountPaise,
      currency: "INR",
      receipt: `thread-${userId.slice(0, 8)}-${Date.now()}`.slice(0, 40),
      notes: { userId, packId: pack.id },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    logger.warn("billing.razorpay_order_failed", { status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) });
    throw serviceError("INTERNAL", "Couldn't start the payment. Try again.");
  }
  const order = (await res.json()) as { id: string; amount: number; currency: string };
  await db.insert(paymentsTable).values({ userId, razorpayOrderId: order.id, packId: pack.id, amount: pack.amountPaise, credits: pack.credits });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId, pack };
}

/**
 * Credits the wallet for a paid order — safe to call twice (Checkout response and webhook both
 * arrive): only the call that flips the order to "paid" adds credits.
 */
export async function completePayment(orderId: string, paymentId: string, paidAmount?: number): Promise<{ credited: boolean; balance: number; userId: string } | null> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(paymentsTable).where(eq(paymentsTable.razorpayOrderId, orderId));
    if (!order) return null;
    if (paidAmount !== undefined && paidAmount !== order.amount) {
      logger.warn("billing.amount_mismatch", { orderId, expected: order.amount, paid: paidAmount });
      return null;
    }
    const flipped = await tx
      .update(paymentsTable)
      .set({ status: "paid", razorpayPaymentId: paymentId, paidAt: new Date() })
      .where(and(eq(paymentsTable.razorpayOrderId, orderId), sql`${paymentsTable.status} <> 'paid'`))
      .returning({ id: paymentsTable.id });
    if (flipped.length === 0) {
      const [wallet] = await tx.select({ balance: creditWalletsTable.balance }).from(creditWalletsTable).where(eq(creditWalletsTable.userId, order.userId));
      return { credited: false, balance: wallet?.balance ?? 0, userId: order.userId };
    }
    await tx.insert(creditWalletsTable).values({ userId: order.userId, balance: 0 }).onConflictDoNothing();
    const [wallet] = await tx
      .update(creditWalletsTable)
      .set({ balance: sql`${creditWalletsTable.balance} + ${order.credits}`, updatedAt: new Date() })
      .where(eq(creditWalletsTable.userId, order.userId))
      .returning({ balance: creditWalletsTable.balance });
    await tx.insert(creditTransactionsTable).values({
      userId: order.userId,
      kind: "purchase",
      delta: order.credits,
      balanceAfter: wallet!.balance,
      note: `${order.packId} pack`,
      paymentId,
    });
    return { credited: true, balance: wallet!.balance, userId: order.userId };
  });
}

export async function markPaymentFailed(orderId: string) {
  await db.update(paymentsTable).set({ status: "failed" }).where(and(eq(paymentsTable.razorpayOrderId, orderId), eq(paymentsTable.status, "created")));
}

// ── Usage overview for admins ────────────────────────────────────────────────

export async function usageOverview(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [bySource, byFeature, daily, topUsers] = await Promise.all([
    db.execute(sql`select source, count(*)::int as events, count(distinct user_id)::int as users from usage_events where created_at >= ${since} group by source order by events desc`),
    db.execute(sql`select feature, source, count(*)::int as events, coalesce(sum(credits),0)::int as credits from usage_events where created_at >= ${since} group by feature, source order by events desc`),
    db.execute(sql`select to_char(created_at, 'YYYY-MM-DD') as day, source, count(*)::int as events from usage_events where created_at >= ${since} group by 1, 2 order by 1`),
    db.execute(sql`select u.email, count(*)::int as events, sum((e.source = 'extension')::int)::int as extension_events from usage_events e join ${usersTable} u on u.id = e.user_id where e.created_at >= ${since} group by u.email order by events desc limit 15`),
  ]);
  return { days, bySource: bySource.rows, byFeature: byFeature.rows, daily: daily.rows, topUsers: topUsers.rows };
}
