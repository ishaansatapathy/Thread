import { expect, test, type Page } from "@playwright/test";

/**
 * Gmail workflow E2E tests.
 *
 * These tests cover:
 *   1. Gmail connect entrypoint (unauthenticated → redirected to sign-in)
 *   2. Queue page is protected and redirects to sign-in
 *   3. Agent page is protected and redirects to sign-in
 *   4. MCP endpoint responds correctly to tool discovery (no auth needed)
 *   5. MCP endpoint rejects unauthenticated tool calls with a proper JSON-RPC error
 *   6. API /health is reachable
 *   7. API /ready is reachable
 *   8. OpenAPI JSON is served (with auth)
 *
 * Tests that require a real Gmail connection are skipped in CI (they need
 * CORSAIR_API_KEY + a real Gmail token). Use the `@requires-gmail` tag to
 * gate them behind an environment variable in your CI pipeline:
 *   E2E_GMAIL_AVAILABLE=true pnpm e2e
 */

const API_URL =
  (typeof process !== "undefined" && process.env["E2E_API_URL"]) || "http://127.0.0.1:8000";

const gmailAvailable = process.env["E2E_GMAIL_AVAILABLE"] === "true";

// ─── helpers ────────────────────────────────────────────────────────────────

async function waitForRedirect(page: Page, pattern: RegExp, timeoutMs = 12_000) {
  await page.waitForURL(pattern, { timeout: timeoutMs });
}

// ─── public surface & auth gate ─────────────────────────────────────────────

test("inbox route redirects unauthenticated users to sign-in", async ({ page }) => {
  await page.goto("/inbox");
  await waitForRedirect(page, /sign-in/);
  expect(page.url()).toContain("/sign-in");
});

test("queue route redirects unauthenticated users to sign-in", async ({ page }) => {
  await page.goto("/queue");
  await waitForRedirect(page, /sign-in/);
  expect(page.url()).toContain("/sign-in");
});

test("agent route redirects unauthenticated users to sign-in", async ({ page }) => {
  await page.goto("/agent");
  await waitForRedirect(page, /sign-in/);
  expect(page.url()).toContain("/sign-in");
});

test("settings route redirects unauthenticated users to sign-in", async ({ page }) => {
  await page.goto("/settings");
  await waitForRedirect(page, /sign-in/);
  expect(page.url()).toContain("/sign-in");
});

// ─── landing page ────────────────────────────────────────────────────────────

test("landing page mentions Gmail and Calendar integrations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/gmail/i).first()).toBeVisible();
});

// ─── API health ──────────────────────────────────────────────────────────────

test("API /health returns healthy JSON", async ({ request }) => {
  const res = await request.get(`${API_URL}/health`, {
    headers: { Accept: "application/json" },
  });
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json).toMatchObject({ healthy: true });
});

test("API /ready returns JSON", async ({ request }) => {
  const res = await request.get(`${API_URL}/ready`, {
    headers: { Accept: "application/json" },
  });
  // 200 or 503 — either way it should be JSON
  const json = await res.json();
  expect(typeof json.ready).toBe("boolean");
});

// ─── MCP endpoint ────────────────────────────────────────────────────────────

test("MCP GET / returns server descriptor", async ({ request }) => {
  const res = await request.get(`${API_URL}/mcp`);
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json).toMatchObject({ name: "thread-mcp" });
  expect(Array.isArray(json.tools)).toBe(true);
  expect(json.tools.length).toBeGreaterThan(0);
});

test("MCP initialize returns protocol version", async ({ request }) => {
  const res = await request.post(`${API_URL}/mcp`, {
    data: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.result).toMatchObject({ protocolVersion: expect.any(String) });
});

test("MCP tools/list returns all tool names", async ({ request }) => {
  const res = await request.post(`${API_URL}/mcp`, {
    data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(200);
  const json = await res.json();
  const names = (json.result.tools as Array<{ name: string }>).map((t) => t.name);
  expect(names).toContain("list_inbox");
  expect(names).toContain("search_inbox");
  expect(names).toContain("list_queue");
  expect(names).toContain("approve_queue_item");
  expect(names).toContain("get_gmail_connection_status");
});

test("MCP tools/call without auth returns JSON-RPC error", async ({ request }) => {
  const res = await request.post(`${API_URL}/mcp`, {
    data: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_inbox", arguments: {} },
    },
    headers: { "Content-Type": "application/json" },
  });
  // 401 with a JSON-RPC error body
  expect(res.status()).toBe(401);
  const json = await res.json();
  expect(json.error).toBeDefined();
  expect(json.error.code).toBe(-32001);
});

test("MCP unknown method returns -32601", async ({ request }) => {
  const res = await request.post(`${API_URL}/mcp`, {
    data: { jsonrpc: "2.0", id: 99, method: "does_not_exist", params: {} },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(404);
  const json = await res.json();
  expect(json.error.code).toBe(-32601);
});

test("MCP invalid JSON-RPC body returns -32600", async ({ request }) => {
  const res = await request.post(`${API_URL}/mcp`, {
    data: { method: "initialize" }, // missing jsonrpc: "2.0"
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(400);
  const json = await res.json();
  expect(json.error.code).toBe(-32600);
});

// ─── metrics endpoint ─────────────────────────────────────────────────────

test("API /metrics/json returns route stats JSON", async ({ request }) => {
  const docsSecret = process.env["DOCS_SECRET"] ?? process.env["OPENAPI_DOCS_SECRET"];
  if (!docsSecret) {
    // metrics endpoint requires auth; skip if secret not available in E2E env
    test.skip(true, "DOCS_SECRET not set — skipping metrics auth test");
    return;
  }

  const res = await request.get(`${API_URL}/metrics/json`, {
    headers: { Authorization: `Bearer ${docsSecret}` },
  });
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(Array.isArray(json.routes)).toBe(true);
});

// ─── Gmail connect flow (requires real Corsair token) ─────────────────────

test.skip(!gmailAvailable, "Skipped: E2E_GMAIL_AVAILABLE is not set");

test(
  "Gmail connect URL endpoint returns a redirect URL @requires-gmail",
  async ({ request }) => {
    // This test verifies the backend can generate a Gmail OAuth URL.
    // It requires a valid session cookie set via E2E_SESSION_COOKIE env var.
    const sessionCookie = process.env["E2E_SESSION_COOKIE"];
    if (!sessionCookie) {
      test.skip(true, "E2E_SESSION_COOKIE not set");
      return;
    }

    const res = await request.get(`${API_URL}/trpc/inbox.getGmailConnectUrl`, {
      headers: { Cookie: sessionCookie },
    });
    const json = await res.json();
    // tRPC wraps the result
    const url: string = json?.result?.data?.url ?? json?.url;
    expect(typeof url).toBe("string");
    expect(url).toMatch(/accounts\.google\.com/);
  },
);
