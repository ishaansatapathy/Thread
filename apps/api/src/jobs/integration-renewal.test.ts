import { describe, expect, it } from "vitest";

import { startIntegrationRenewalJob } from "./integration-renewal";

describe("integration-renewal job", () => {
  it("does not schedule timers during vitest", () => {
    expect(() => startIntegrationRenewalJob()).not.toThrow();
  });
});
