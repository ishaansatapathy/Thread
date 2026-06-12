import { describe, expect, it } from "vitest";

import { decodePubSubData } from "./webhooks";

describe("decodePubSubData", () => {
  it("decodes a base64 Pub/Sub push envelope", () => {
    const payload = { emailAddress: "user@example.com", historyId: "12345" };
    const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    expect(decodePubSubData({ message: { data } })).toEqual(payload);
  });

  it("returns null when there is no message data", () => {
    expect(decodePubSubData({})).toBeNull();
    expect(decodePubSubData(null)).toBeNull();
    expect(decodePubSubData({ message: {} })).toBeNull();
  });

  it("returns null for malformed base64 json", () => {
    expect(decodePubSubData({ message: { data: "%%%not-base64-json%%%" } })).toBeNull();
  });
});
