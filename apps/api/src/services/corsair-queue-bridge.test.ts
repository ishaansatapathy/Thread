import { describe, expect, it } from "vitest";

import {
  extractCorsairApprovalToken,
  isCorsairApprovalRequiredError,
} from "./corsair-queue-bridge";

describe("corsair-queue-bridge", () => {
  it("extracts token from approval message", () => {
    const msg =
      "Action requires approval. Visit https://example.com/corsair/approve/abc123def456 to approve or deny, then retry.";
    expect(extractCorsairApprovalToken(msg)).toBe("abc123def456");
    expect(isCorsairApprovalRequiredError(new Error(msg))).toBe(true);
  });

  it("returns null when no token present", () => {
    expect(extractCorsairApprovalToken("Something else failed")).toBeNull();
    expect(isCorsairApprovalRequiredError(new Error("network error"))).toBe(false);
  });
});
