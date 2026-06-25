import { expect, test } from "@playwright/test";

/**
 * Authenticated inbox smoke test — uses demo login when enabled.
 */
test("inbox page loads after demo login", async ({ page }) => {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    test.skip(true, "DEMO_LOGIN_ENABLED is not set");
    return;
  }

  await page.goto("/api-auth/demo?next=/inbox");
  await page.waitForURL(/\/inbox/, { timeout: 20_000 });

  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Priority" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Drafts" })).toBeVisible();
});

test("demo inbox shows seeded threads without Gmail OAuth", async ({ page }) => {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    test.skip(true, "DEMO_LOGIN_ENABLED is not set");
    return;
  }

  await page.goto("/api-auth/demo?next=/inbox");
  await page.waitForURL(/\/inbox/, { timeout: 20_000 });

  await expect(page.getByText(/Series A|Demo inbox|term sheet/i).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("queue page loads after demo login", async ({ page }) => {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    test.skip(true, "DEMO_LOGIN_ENABLED is not set");
    return;
  }

  await page.goto("/api-auth/demo?next=/queue");
  await page.waitForURL(/\/queue/, { timeout: 20_000 });
  await expect(page.getByText(/approval queue|queue/i).first()).toBeVisible();
});
