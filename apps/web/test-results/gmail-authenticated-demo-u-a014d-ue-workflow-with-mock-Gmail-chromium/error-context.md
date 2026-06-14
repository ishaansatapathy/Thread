# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gmail-authenticated.spec.ts >> demo user can complete queue workflow with mock Gmail
- Location: e2e\gmail-authenticated.spec.ts:46:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForURL: Test timeout of 30000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
  navigated to "http://localhost:3000/sign-in?error=Demo+login+failed.+Run+the+production+seed+and+try+again."
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - link "Thread THREAD" [ref=e5] [cursor=pointer]:
          - /url: /
          - img "Thread" [ref=e6]
          - generic "THREAD" [ref=e7]:
            - generic [ref=e8]: T
            - generic [ref=e9]: H
            - generic [ref=e10]: R
            - generic [ref=e11]: E
            - generic [ref=e12]: Λ
            - generic [ref=e13]: D
        - navigation "Site" [ref=e14]:
          - link "How it works" [ref=e15] [cursor=pointer]:
            - /url: /#how
          - link "Workflows" [ref=e16] [cursor=pointer]:
            - /url: /#workflows
          - link "Integrations" [ref=e17] [cursor=pointer]:
            - /url: /#integrations
          - link "Agent" [ref=e18] [cursor=pointer]:
            - /url: /#agent
          - link "FAQ" [ref=e19] [cursor=pointer]:
            - /url: /#faq
    - main [ref=e20]:
      - generic [ref=e21]:
        - img "Thread" [ref=e23]
        - heading "Log in to Thread" [level=1] [ref=e24]
        - link "Continue with Google" [ref=e25] [cursor=pointer]:
          - /url: /api-auth/google?state=%2Finbox
          - img [ref=e26]
          - text: Continue with Google
        - link "Try demo — no signup" [ref=e31] [cursor=pointer]:
          - /url: /api-auth/demo?next=%2Finbox
        - paragraph [ref=e32]: or
        - generic [ref=e33]:
          - textbox "Email address" [ref=e34]
          - textbox "Password" [ref=e35]
          - paragraph [ref=e36]: Demo login failed. Run the production seed and try again.
          - button "Sign in" [disabled] [ref=e37]
        - button "Don't have an account? Sign up →" [ref=e38] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=e47] [cursor=pointer]:
    - img [ref=e48]
  - alert [ref=e51]
  - region "Notifications alt+T"
```

# Test source

```ts
  1  | import { expect, type Page } from "@playwright/test";
  2  | 
  3  | export async function demoLogin(page: Page, next = "/inbox") {
  4  |   await page.goto(`/api-auth/demo?next=${encodeURIComponent(next)}`);
> 5  |   await page.waitForURL(new RegExp(next.replace("/", "\\/")), { timeout: 20_000 });
     |              ^ Error: page.waitForURL: Test timeout of 30000ms exceeded.
  6  | }
  7  | 
  8  | export function skipUnlessDemoLogin(test: { skip: (condition: boolean, reason: string) => void }) {
  9  |   const enabled = process.env.DEMO_LOGIN_ENABLED ?? "true";
  10 |   if (enabled !== "true") {
  11 |     test.skip(true, "DEMO_LOGIN_ENABLED is not set");
  12 |   }
  13 | }
  14 | 
```