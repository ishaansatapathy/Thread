import { expect, test } from "@playwright/test";

import { demoLogin, skipUnlessDemoLogin } from "./helpers/auth";

/**
 * Full approval workflow: compose → queue → approve.
 * Uses THREAD_E2E_MOCK_GMAIL so approve succeeds without live Gmail OAuth.
 */
test("compose → queue → approve email workflow", async ({ page }) => {
  skipUnlessDemoLogin(test);

  const subject = `E2E workflow ${Date.now()}`;

  await demoLogin(page, "/inbox?compose=1");

  await expect(page.getByRole("heading", { name: "New message" })).toBeVisible({ timeout: 10_000 });

  await page.locator("#compose-to").fill("workflow@thread.dev");
  await page.locator("#compose-subject").fill(subject);
  await page.locator("#compose-body").fill("Automated E2E test — queued then approved.");

  await page.getByRole("button", { name: "Queue send" }).click();

  await expect(page.getByText(/added to your queue|queue/i).first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/queue");
  await page.waitForURL(/\/queue/, { timeout: 10_000 });

  const card = page.locator(".thread-queue-card").filter({ hasText: subject });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole("button", { name: /Approve/i }).click();

  await expect(page.getByText(/Approved and sent/i)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "History" }).click();
  const historyCard = page.locator(".thread-queue-card").filter({ hasText: subject });
  await expect(historyCard.getByText("approved")).toBeVisible({ timeout: 10_000 });
});

test("seeded pending item can be approved with mock Gmail", async ({ page }) => {
  skipUnlessDemoLogin(test);

  await demoLogin(page, "/queue");

  const seeded = page.locator(".thread-queue-card").filter({ hasText: "Welcome to Thread demo" });
  await expect(seeded).toBeVisible({ timeout: 10_000 });

  await seeded.getByRole("button", { name: /Approve/i }).click();
  await expect(page.getByText(/Approved and sent/i)).toBeVisible({ timeout: 15_000 });
});
