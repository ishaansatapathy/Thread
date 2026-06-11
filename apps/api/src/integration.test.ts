import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "./server";

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
    expect(response.body.info?.title).toBe("Thread API");
    expect(response.body.paths?.["/health"]).toBeTruthy();
  });
});
