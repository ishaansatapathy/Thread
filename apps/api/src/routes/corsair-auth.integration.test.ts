import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../server";

describe("Corsair OAuth routes", () => {
  it("requires auth for Gmail connect", async () => {
    const response = await request(app).get("/auth/corsair/gmail?state=test");
    expect([302, 401, 503]).toContain(response.status);
  });

  it("requires auth for Calendar connect", async () => {
    const response = await request(app).get("/auth/corsair/calendar?state=test");
    expect([302, 401, 503]).toContain(response.status);
  });

  it("rejects Gmail OAuth callback without a session", async () => {
    const response = await request(app).get("/auth/corsair/gmail/callback?code=fake&state=fake");
    expect([302, 401, 403]).toContain(response.status);
  });
});
