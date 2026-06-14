import { expect, test } from "@playwright/test";

import { demoLogin, skipUnlessDemoLogin } from "./helpers/auth";

const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const gmailAvailable = process.env.E2E_GMAIL_AVAILABLE === "true";
const sessionCookie = process.env.E2E_SESSION_COOKIE?.trim();

test.describe("Gmail-connected flows (optional)", () => {
  test.skip(!gmailAvailable, "Set E2E_GMAIL_AVAILABLE=true to run live Gmail E2E");

  test("Gmail OAuth connect URL is generated for authenticated session", async ({ request }) => {
    if (!sessionCookie) {
      test.skip(true, "Set E2E_SESSION_COOKIE with jwt cookies from a connected account");
      return;
    }

    const res = await request.get(`${API_URL}/trpc/inbox.getGmailConnectUrl`, {
      headers: { Cookie: sessionCookie },
    });
    const json = await res.json();
    const url: string = json?.result?.data?.json?.url ?? json?.result?.data?.url ?? "";
    expect(url).toMatch(/accounts\.google\.com/);
  });

  test("connected Gmail returns threads via tRPC", async ({ request }) => {
    if (!sessionCookie) {
      test.skip(true, "Set E2E_SESSION_COOKIE with jwt cookies from a connected account");
      return;
    }

    const res = await request.get(`${API_URL}/trpc/inbox.listThreads?batch=1&input=${encodeURIComponent(
      JSON.stringify({ 0: { json: { maxResults: 5 } } }),
    )}`, {
      headers: {
        Cookie: sessionCookie,
        "x-thread-csrf": "1",
      },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toBeTruthy();
  });
});

test("demo user can complete queue workflow with mock Gmail", async ({ page }) => {
  skipUnlessDemoLogin(test);

  await demoLogin(page, "/inbox?compose=1");
  const subject = `Judge smoke ${Date.now()}`;
  await page.locator("#compose-to").fill("judge@thread.dev");
  await page.locator("#compose-subject").fill(subject);
  await page.locator("#compose-body").fill("Hackathon judge smoke — queued then approved.");
  await page.getByRole("button", { name: "Queue send" }).click();
  await page.goto("/queue");
  const card = page.locator(".thread-queue-card").filter({ hasText: subject });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: /Approve/i }).click();
  await expect(page.getByText(/Approved and sent/i)).toBeVisible({ timeout: 15_000 });
});
