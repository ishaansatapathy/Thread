import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../server";

const WEBHOOK_SECRET = process.env.CORSAIR_WEBHOOK_SECRET ?? "ci-test-webhook-secret-min-16-chars";

describe("Gmail webhook route", () => {
  it("rejects requests without a valid webhook secret", async () => {
    const response = await request(app)
      .post("/webhooks/gmail")
      .send({
        message: {
          data: Buffer.from(
            JSON.stringify({ emailAddress: "demo@thread.dev", historyId: "999" }),
            "utf8",
          ).toString("base64"),
        },
      });

    expect([401, 503]).toContain(response.status);
    expect(response.body.ok).toBe(false);
  });

  it("accepts authorized Pub/Sub push envelopes with 200", async () => {
    const response = await request(app)
      .post("/webhooks/gmail")
      .set("x-corsair-webhook-secret", WEBHOOK_SECRET)
      .send({
        message: {
          data: Buffer.from(
            JSON.stringify({ emailAddress: "demo@thread.dev", historyId: "12345" }),
            "utf8",
          ).toString("base64"),
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("accepts calendar webhook when authorized", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const response = await request(app)
      .post("/webhooks/calendar")
      .set("x-corsair-webhook-secret", WEBHOOK_SECRET)
      .set("x-goog-channel-id", `thread-calendar-${tenantId}-${Date.now()}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
