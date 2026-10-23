import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../server";

describe("meetings routes", () => {
  it("requires auth to create a meeting", async () => {
    const response = await request(app).post("/meetings").send({ title: "Standup" });
    expect(response.status).toBe(401);
  });

  it("requires auth to list meetings", async () => {
    const response = await request(app).get("/meetings");
    expect(response.status).toBe(401);
  });

  it("requires auth to fetch one meeting", async () => {
    const response = await request(app).get("/meetings/00000000-0000-0000-0000-000000000000");
    expect(response.status).toBe(401);
  });

  it("requires auth before accepting a live chunk or ending a meeting", async () => {
    const chunk = await request(app)
      .post("/meetings/00000000-0000-0000-0000-000000000000/chunk")
      .set("Content-Type", "audio/wav")
      .set("X-Start-Seconds", "0")
      .set("X-Duration-Seconds", "2")
      .send(Buffer.from("fake audio"));
    expect(chunk.status).toBe(401);

    const end = await request(app).post("/meetings/00000000-0000-0000-0000-000000000000/end");
    expect(end.status).toBe(401);
  });

  it("requires auth for voice transcription", async () => {
    const response = await request(app)
      .post("/speech/transcribe")
      .set("Content-Type", "audio/wav")
      .send(Buffer.from("fake audio"));
    expect(response.status).toBe(401);
  });

  it("requires auth before accepting an audio upload", async () => {
    const response = await request(app)
      .post("/meetings/00000000-0000-0000-0000-000000000000/audio")
      .set("Content-Type", "audio/wav")
      .send(Buffer.from("fake audio"));
    expect(response.status).toBe(401);
  });
});
