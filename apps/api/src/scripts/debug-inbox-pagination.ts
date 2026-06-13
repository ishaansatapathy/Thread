/**
 * Diagnostic: raw Gmail threads.list vs inbox.listThreads service.
 * Run from repo root:
 *   pnpm exec dotenv -e .env -- pnpm --filter @repo/api exec tsx src/scripts/debug-inbox-pagination.ts
 */
import { config } from "dotenv";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../..");
config({ path: path.join(repoRoot, ".env") });

import { eq } from "@repo/database";
import db from "@repo/database";
import { usersTable } from "@repo/database/schema";
import { INBOX_PAGE_SIZE } from "@repo/services/inbox";

import { getCorsair, isCorsairConfigured } from "../corsair";
import { ensureCorsairTenant } from "../services/corsair-tenant";
import { CorsairInboxService } from "../services/inbox";

async function main() {
  if (!isCorsairConfigured()) {
    console.error("Corsair not configured");
    process.exit(1);
  }

  const users = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).limit(5);
  if (users.length === 0) {
    console.error("No users in database");
    process.exit(1);
  }

  const tenantId = users[0]!.id;
  console.log("User:", users[0]!.email, tenantId);

  await ensureCorsairTenant(tenantId);
  const corsair = getCorsair().withTenant(tenantId);

  const raw = await corsair.gmail.api.threads.list({
    maxResults: INBOX_PAGE_SIZE,
    labelIds: ["INBOX"],
  });

  console.log("\n--- Raw Gmail threads.list ---");
  console.log("threads:", (raw as { threads?: unknown[] }).threads?.length ?? 0);
  console.log("nextPageToken:", (raw as { nextPageToken?: string }).nextPageToken ?? "(none)");
  console.log("resultSizeEstimate:", (raw as { resultSizeEstimate?: number }).resultSizeEstimate ?? "(none)");

  const inbox = new CorsairInboxService();
  const status = await inbox.getConnectionStatus(tenantId);
  console.log("\nConnection:", status);

  const cached = await inbox.listCachedThreads(tenantId, { limit: INBOX_PAGE_SIZE });
  console.log("\n--- listCachedThreads ---");
  console.log("threads:", cached.threads.length);

  const stale = await inbox.listThreads(tenantId, { maxResults: INBOX_PAGE_SIZE });
  console.log("\n--- listThreads (default) ---");
  console.log("threads:", stale.threads.length);
  console.log("nextPageToken:", stale.nextPageToken ?? "(none)");
  console.log("stale:", stale.stale ?? false);

  const fresh = await inbox.listThreads(tenantId, { maxResults: INBOX_PAGE_SIZE, refresh: true });
  console.log("\n--- listThreads (refresh=true) ---");
  console.log("threads:", fresh.threads.length);
  console.log("nextPageToken:", fresh.nextPageToken ?? "(none)");
  console.log("stale:", fresh.stale ?? false);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
