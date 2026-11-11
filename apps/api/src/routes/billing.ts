/**
 * Credits and payments:
 *   GET  /billing                 balance, packs, prices, history
 *   POST /billing/order           { packId } → Razorpay order for Checkout
 *   POST /billing/verify          { orderId, paymentId, signature } → credits the wallet
 *   POST /billing/webhook         Razorpay → credits the wallet even if the tab was closed
 *   GET  /billing/admin/usage     admins only: who uses what, web vs Chrome extension
 */
import express, { Router } from "express";
import { z } from "zod";

import AuthService from "@repo/services/auth";
import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";
import { isAdminRole } from "@repo/services/auth/roles";
import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";

import {
  completePayment,
  createOrder,
  getBillingSummary,
  markPaymentFailed,
  usageOverview,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "../services/billing";

const authService = new AuthService();

export const billingRouter = Router();

const orderSchema = z.object({ packId: z.string().min(1).max(40) });
const verifySchema = z.object({
  orderId: z.string().min(1).max(80),
  paymentId: z.string().min(1).max(80),
  signature: z.string().min(1).max(200),
});

function sendError(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof ServiceError) {
    const status = error.code === "PRECONDITION_FAILED" ? 412 : error.code === "BAD_REQUEST" ? 400 : 502;
    return res.status(status).json({ error: error.message });
  }
  logger.warn("billing.route_failed", { message: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: fallback });
}

billingRouter.get("/", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  try {
    return res.json({ ...(await getBillingSummary(user.id)), isAdmin: isAdminRole(user.role) });
  } catch (error) {
    return sendError(res, error, "Could not load your credits.");
  }
});

billingRouter.post("/order", express.json({ limit: "2kb" }), async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (process.env.VITEST !== "true") {
    const limit = await checkDistributedRateLimit(`billing-order:${user.id}`, 10, 60_000);
    if (!limit.allowed) return res.status(429).json({ error: "Too many attempts. Try again in a minute." });
  }
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick a credit pack." });
  try {
    return res.json(await createOrder(user.id, parsed.data.packId));
  } catch (error) {
    return sendError(res, error, "Could not start the payment.");
  }
});

billingRouter.post("/verify", express.json({ limit: "2kb" }), async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing payment details." });
  const { orderId, paymentId, signature } = parsed.data;
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
    return res.status(400).json({ error: "Payment could not be verified." });
  }
  try {
    const result = await completePayment(orderId, paymentId);
    // An order is only ever credited to the account that created it.
    if (!result || result.userId !== user.id) return res.status(404).json({ error: "Order not found." });
    return res.json({ credited: result.credited, balance: result.balance });
  } catch (error) {
    return sendError(res, error, "Could not add your credits. If you were charged, they'll arrive shortly.");
  }
});

type RazorpayEvent = {
  event?: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } };
};

/** Razorpay calls this server-to-server; the signature over the raw body is the only credential. */
billingRouter.post("/webhook", async (req, res) => {
  const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
  const signature = String(req.headers["x-razorpay-signature"] ?? "");
  if (!raw || !verifyWebhookSignature(raw, signature)) {
    return res.status(400).json({ error: "Invalid signature" });
  }
  const body = req.body as RazorpayEvent;
  const payment = body.payload?.payment?.entity;
  try {
    if (body.event === "payment.captured" && payment?.id && payment.order_id) {
      const result = await completePayment(payment.order_id, payment.id, payment.amount);
      logger.info("billing.webhook_payment", { orderId: payment.order_id, credited: result?.credited ?? false });
    } else if (body.event === "payment.failed" && payment?.order_id) {
      await markPaymentFailed(payment.order_id);
    }
    return res.json({ ok: true });
  } catch (error) {
    // 5xx makes Razorpay retry, which is what we want for a transient database error.
    logger.warn("billing.webhook_failed", { message: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ error: "Could not process the event" });
  }
});

billingRouter.get("/admin/usage", async (req, res) => {
  const user = await authService.resolveSession(req, res);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!isAdminRole(user.role)) return res.status(403).json({ error: "Admins only." });
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7) || 7));
  try {
    return res.json(await usageOverview(days));
  } catch (error) {
    return sendError(res, error, "Could not load usage.");
  }
});
