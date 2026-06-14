import { describe, expect, it, afterEach } from "vitest";

import { publishSyncEvent, resetSyncEventListeners, subscribeSyncEvents } from "./sync-events";

describe("sync-events", () => {
  afterEach(() => {
    resetSyncEventListeners();
  });

  it("delivers inbox_updated to tenant subscribers", () => {
    const received: string[] = [];
    subscribeSyncEvents("tenant-a", (event) => {
      received.push(event.type);
    });

    publishSyncEvent({ type: "inbox_updated", tenantId: "tenant-a" });
    publishSyncEvent({ type: "calendar_updated", tenantId: "tenant-b" });

    expect(received).toEqual(["inbox_updated"]);
  });

  it("unsubscribes cleanly", () => {
    const received: string[] = [];
    const unsubscribe = subscribeSyncEvents("tenant-a", (event) => {
      received.push(event.type);
    });

    publishSyncEvent({ type: "inbox_updated", tenantId: "tenant-a" });
    unsubscribe();
    publishSyncEvent({ type: "calendar_updated", tenantId: "tenant-a" });

    expect(received).toEqual(["inbox_updated"]);
  });
});
