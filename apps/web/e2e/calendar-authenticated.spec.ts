import { expect, test } from "@playwright/test";

test("calendar page loads after demo login", async ({ page }) => {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    test.skip(true, "DEMO_LOGIN_ENABLED is not set");
    return;
  }

  await page.goto("/api-auth/demo?next=/calendar");
  await page.waitForURL(/\/calendar/, { timeout: 20_000 });
  await expect(page.getByText(/Your schedule|Calendar not connected/i).first()).toBeVisible();
});
