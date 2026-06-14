import { expect, test } from "@playwright/test";

/**
 * Demo login flow — requires DEMO_LOGIN_ENABLED=true and a seeded demo user.
 * CI sets these via playwright webServer env + db:seed.
 */
test("demo login redirects to inbox when enabled", async ({ page }) => {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    test.skip(true, "DEMO_LOGIN_ENABLED is not set");
    return;
  }

  await page.goto("/api-auth/demo?next=/inbox");
  await page.waitForURL(/\/inbox/, { timeout: 20_000 });
  expect(page.url()).toContain("/inbox");
});

test("demo login shows error when disabled", async ({ page }) => {
  if (process.env.DEMO_LOGIN_ENABLED === "true") {
    test.skip(true, "Demo login is enabled in this environment");
    return;
  }

  await page.goto("/api-auth/demo?next=/inbox");
  await page.waitForURL(/sign-in/, { timeout: 10_000 });
  expect(page.url()).toContain("/sign-in");
});
