import { describe, expect, it } from "vitest";

import { decodePubSubData, tenantFromCalendarChannel } from "./webhooks";

describe("webhook helpers", () => {
  it("decodes Pub/Sub push data", () => {
    const payload = { emailAddress: "a@b.com", historyId: "42" };
    const body = {
      message: {
        data: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
      },
    };
    expect(decodePubSubData(body)).toEqual(payload);
  });

  it("extracts tenant id from calendar channel header", () => {
    const tenantId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const req = {
      header: (name: string) =>
        name === "x-goog-channel-id" ? `thread-calendar-${tenantId}-1710000000000` : undefined,
    } as Parameters<typeof tenantFromCalendarChannel>[0];

    expect(tenantFromCalendarChannel(req)).toBe(tenantId);
  });
});
