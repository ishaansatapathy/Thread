import { describe, expect, it } from "vitest";

import { matchesProcedure, normalizeProcedurePath } from "./rate-limiters";

describe("rate limiter procedure matching", () => {
  it("maps REST OpenAPI paths to tRPC procedure names", () => {
    expect(normalizeProcedurePath("/authentication/sign-in")).toBe("auth.signIn");
    expect(normalizeProcedurePath("/authentication/forgot-password")).toBe("auth.forgotPassword");
  });

  it("keeps normal tRPC procedure paths unchanged", () => {
    expect(normalizeProcedurePath("/auth.signIn")).toBe("auth.signIn");
  });

  it("requires exact procedure segment matches", () => {
    expect(matchesProcedure("auth.signIn", ["auth.signIn"])).toBe(true);
    expect(matchesProcedure("auth.signInWithMagicLink", ["auth.signIn"])).toBe(false);
  });
});
