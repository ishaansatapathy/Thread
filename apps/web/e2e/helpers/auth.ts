import { expect, type Page } from "@playwright/test";

export async function demoLogin(page: Page, next = "/inbox") {
  await page.goto(`/api-auth/demo?next=${encodeURIComponent(next)}`);
  await page.waitForURL(new RegExp(next.replace("/", "\\/")), { timeout: 20_000 });
}

export function skipUnlessDemoLogin(test: { skip: (condition: boolean, reason: string) => void }) {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    test.skip(true, "DEMO_LOGIN_ENABLED is not set");
  }
}
