import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the public surface and the auth gate. These run against a
 * live dev server (see playwright.config.ts) and need no Gmail/Calendar
 * connection, so they are safe to run in CI without secrets.
 */

test("landing page renders the product hero and primary nav", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/thread/i);
  // The marquee / hero mention the core integrations.
  await expect(page.getByText(/gmail/i).first()).toBeVisible();
});

test("protected app routes redirect unauthenticated users to sign-in", async ({ page }) => {
  await page.goto("/inbox");
  await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
  expect(page.url()).toContain("/sign-in");
});

test("sign-in page is reachable and shows the email field", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
});
