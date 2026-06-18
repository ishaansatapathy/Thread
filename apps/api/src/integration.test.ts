import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "./server";

const QUEUE_OPENAPI_PATHS = [
  "/queue/pending-count",
  "/queue/items",
  "/queue/enqueue/email",
  "/queue/enqueue/calendar",
  "/queue/enqueue/meeting",
  "/queue/enqueue/calendar-archive",
  "/queue/enqueue/calendar-delete",
  "/queue/approve",
  "/queue/dismiss",
] as const;

const AI_OPENAPI_PATHS = ["/ai/status", "/ai/inbox/rank"] as const;

describe("Thread API integration", () => {
  it("returns healthy status", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.healthy).toBe(true);
  });

  it("returns readiness report with named checks", async () => {
    const response = await request(app).get("/ready");
    expect([200, 503]).toContain(response.status);
    expect(typeof response.body.ready).toBe("boolean");
    expect(response.body.checks?.database).toBeTruthy();
    expect(response.body.checks?.coreEnv).toBeTruthy();
  });

  it("serves generated OpenAPI documentation", async () => {
    const response = await request(app).get("/openapi.json");
    expect(response.status).toBe(200);
    expect(response.body.info?.title).toBe("Thread API — Corsair Gmail & Calendar");
    expect(response.body.paths?.["/health"]).toBeTruthy();
  });

  it("documents queue and AI REST endpoints for external agents", async () => {
    const response = await request(app).get("/openapi.json");
    expect(response.status).toBe(200);

    for (const path of QUEUE_OPENAPI_PATHS) {
      expect(response.body.paths?.[path], `missing OpenAPI path ${path}`).toBeTruthy();
    }

    for (const path of AI_OPENAPI_PATHS) {
      expect(response.body.paths?.[path], `missing OpenAPI path ${path}`).toBeTruthy();
    }

    const approvePath = response.body.paths?.["/queue/approve"];
    expect(approvePath?.post).toBeTruthy();
  });
});
