import { randomUUID } from "node:crypto";

import request from "supertest";
import { eq } from "@repo/database";
import db from "@repo/database";
import { meetingRecordingsTable, usersTable } from "@repo/database/schema";
import { issueExtensionToken } from "@repo/services/auth/jwt";
import { describe, expect, it } from "vitest";

import { app } from "../server";

const EXTENSION_ORIGIN = "chrome-extension://amjfmmikjmlcaacliifdkdnbjanlcipf";

async function withUser(run: (user: { id: string; email: string; token: string }) => Promise<void>) {
  const id = randomUUID();
  const email = `ext-${id}@test.local`;
  await db.insert(usersTable).values({
    id,
    fullName: "Extension Test",
    email,
    passwordHash: "x",
    authProvider: "local",
    emailVerified: true,
    role: "user",
    tokenVersion: "0",
  });
  try {
    await run({ id, email, token: issueExtensionToken({ id, tokenVersion: "0" }).token });
  } finally {
    await db.delete(meetingRecordingsTable).where(eq(meetingRecordingsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
}

describe("extension auth", () => {
  it("only mints tokens from a signed-in cookie session", async () => {
    const response = await request(app).post("/extension/token").set("Origin", "http://localhost:3000");
    expect(response.status).toBe(401);
  });

  it("rejects a forged bearer token", async () => {
    const response = await request(app).get("/extension/me").set("Authorization", "Bearer not.a.token");
    expect(response.status).toBe(401);
  });

  it("accepts the extension's bearer token and works from a chrome-extension origin", async () => {
    await withUser(async (user) => {
      const me = await request(app).get("/extension/me").set("Authorization", `Bearer ${user.token}`);
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ id: user.id, email: user.email });

      // A POST from the extension's own origin isn't a CSRF risk: no cookies are involved.
      const created = await request(app)
        .post("/meetings")
        .set("Origin", EXTENSION_ORIGIN)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ mode: "live", meetUrl: "https://meet.google.com/abc-defg-hij" });
      expect(created.status).toBe(201);
    });
  });

  it("still blocks untrusted origins for cookie-authenticated requests", async () => {
    const response = await request(app)
      .post("/meetings")
      .set("Origin", "https://evil.example")
      .set("Cookie", "jwt=whatever")
      .send({});
    expect(response.status).toBe(403);
  });

  it("can't be replayed as a session cookie", async () => {
    await withUser(async (user) => {
      const response = await request(app).get("/meetings").set("Cookie", `jwt=${user.token}`);
      expect(response.status).toBe(401);
    });
  });

  it("stops working once the user signs out everywhere (token version bump)", async () => {
    await withUser(async (user) => {
      await db.update(usersTable).set({ tokenVersion: "1" }).where(eq(usersTable.id, user.id));
      const response = await request(app).get("/extension/me").set("Authorization", `Bearer ${user.token}`);
      expect(response.status).toBe(401);
    });
  });

  it("validates Captain Thread page context before running the agent", async () => {
    await withUser(async (user) => {
      const auth = { Authorization: `Bearer ${user.token}`, Origin: EXTENSION_ORIGIN };
      const badSource = await request(app)
        .post("/agent/stream")
        .set(auth)
        .send({ message: "Explain this", pageContext: { url: "https://leetcode.com/problems/two-sum/", text: "Given an array…", source: "screenshot" } });
      expect(badSource.status).toBe(400);

      const tooLong = await request(app)
        .post("/agent/stream")
        .set(auth)
        .send({ message: "Explain this", pageContext: { url: "https://example.com", text: "x".repeat(6001), source: "selection" } });
      expect(tooLong.status).toBe(400);

      const notAUrl = await request(app)
        .post("/agent/stream")
        .set(auth)
        .send({ message: "Explain this", pageContext: { url: "javascript-ish", text: "hello", source: "selection" } });
      expect(notAUrl.status).toBe(400);
    });
  });

  it("finds the room for a Meet call by its link, ignoring query params", async () => {
    await withUser(async (user) => {
      const auth = { Authorization: `Bearer ${user.token}`, Origin: EXTENSION_ORIGIN };
      await request(app).post("/meetings").set(auth).send({ mode: "live", meetUrl: "https://meet.google.com/abc-defg-hij" });
      await request(app).post("/meetings").set(auth).send({ mode: "live", meetUrl: "https://meet.google.com/zzz-yyyy-xxx" });

      const response = await request(app)
        .get(`/meetings?meetUrl=${encodeURIComponent("https://meet.google.com/abc-defg-hij?authuser=1")}`)
        .set(auth);
      expect(response.status).toBe(200);
      expect(response.body.meetings).toHaveLength(1);
      expect(response.body.meetings[0].meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    });
  });
});
