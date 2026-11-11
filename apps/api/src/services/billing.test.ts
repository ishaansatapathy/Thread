import { createHmac } from "node:crypto";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CREDIT_PACKS,
  dubCost,
  speakCost,
  usageSource,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./billing";

const sign = (secret: string, payload: string | Buffer) => createHmac("sha256", secret).update(payload).digest("hex");
const request = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

describe("billing helpers", () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_SECRET = "key-secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "hook-secret";
  });
  afterEach(() => {
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  it("accepts the signature Razorpay Checkout returns, and rejects anything else", () => {
    expect(verifyCheckoutSignature("order_1", "pay_1", sign("key-secret", "order_1|pay_1"))).toBe(true);
    expect(verifyCheckoutSignature("order_1", "pay_2", sign("key-secret", "order_1|pay_1"))).toBe(false);
    expect(verifyCheckoutSignature("order_1", "pay_1", sign("other-secret", "order_1|pay_1"))).toBe(false);
    expect(verifyCheckoutSignature("order_1", "pay_1", "")).toBe(false);
  });

  it("verifies webhooks against the exact raw body", () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(verifyWebhookSignature(body, sign("hook-secret", body))).toBe(true);
    expect(verifyWebhookSignature(Buffer.from('{"event":"payment.captured" }'), sign("hook-secret", body))).toBe(false);
    expect(verifyWebhookSignature(body, "")).toBe(false);
  });

  it("refuses everything when the secrets are not configured", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(verifyCheckoutSignature("o", "p", sign("", "o|p"))).toBe(false);
    expect(verifyWebhookSignature("x", sign("", "x"))).toBe(false);
  });

  it("prices read-aloud per started 1,000 characters and dubbing per started minute", () => {
    expect(speakCost(1)).toBe(1);
    expect(speakCost(1000)).toBe(1);
    expect(speakCost(1001)).toBe(2);
    expect(dubCost(30)).toBe(10);
    expect(dubCost(61)).toBe(20);
  });

  it("tells extension requests (bearer, no cookie) from web requests", () => {
    expect(usageSource(request({ authorization: "Bearer abc123" }))).toBe("extension");
    expect(usageSource(request({ authorization: "Bearer abc123", cookie: "jwt=x" }))).toBe("web");
    expect(usageSource(request({ cookie: "jwt=x" }))).toBe("web");
  });

  it("has packs with unique ids and a better rate for bigger packs", () => {
    expect(new Set(CREDIT_PACKS.map((p) => p.id)).size).toBe(CREDIT_PACKS.length);
    const rates = CREDIT_PACKS.map((p) => p.amountPaise / p.credits);
    expect([...rates].sort((a, b) => b - a)).toEqual(rates);
  });
});
