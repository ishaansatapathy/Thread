import { gmailEndpointSchemas } from "@corsair-dev/gmail";
import { googlecalendarEndpointSchemas } from "@corsair-dev/googlecalendar";

import { getCorsair, getCorsairPool, isCorsairConfigured } from "../src/corsair";

function collectFns(obj: unknown, prefix = "", depth = 0): string[] {
  const out: string[] = [];
  if (!obj || typeof obj !== "object" || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "function") out.push(path);
    else if (v && typeof v === "object") out.push(...collectFns(v, path, depth + 1));
  }
  return out;
}

function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(title);
  console.log("─".repeat(60));
}

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║           CORSAIR FULL AUDIT — Thread Hackathon               ║");
console.log("╚══════════════════════════════════════════════════════════════╝");

async function main() {

const gmailOps = Object.keys(gmailEndpointSchemas).sort();
const calOps = Object.keys(googlecalendarEndpointSchemas).sort();

section(`📦 OFFICIAL SDK (@corsair-dev/*) — ${gmailOps.length + calOps.length} API ops`);
console.log(`Gmail: ${gmailOps.length} | Calendar: ${calOps.length}`);
for (const op of gmailOps) console.log(`  gmail.api.${op}`);
for (const op of calOps) console.log(`  googlecalendar.api.${op}`);

section("📂 DB SEARCH (Corsair local cache — 6 endpoints)");
for (const op of [
  "gmail.db.threads.search",
  "gmail.db.messages.search",
  "gmail.db.drafts.search",
  "gmail.db.labels.search",
  "googlecalendar.db.events.search",
  "googlecalendar.db.calendars.search",
]) {
  console.log(`  ${op}`);
}

section("🪝 PLUGIN WEBHOOKS (2 handlers)");
console.log("  gmail.messageChanged          → inbox refresh");
console.log("  googlecalendar.onEventChanged → calendar refresh");

section("🌐 HTTP WEBHOOK ROUTES (3)");
console.log("  POST /webhooks/corsair");
console.log("  POST /webhooks/gmail");
console.log("  POST /webhooks/calendar");

section("🔧 API HOOKS (5)");
console.log("  gmail.messages.send.after | gmail.threads.list.after | gmail.drafts.send.after");
console.log("  googlecalendar.events.create.after | googlecalendar.events.delete.before");

section("🔐 PERMISSIONS (cautious)");
console.log("  threads.delete, messages.delete, events.delete → require_approval");

section("🤖 MCP");
console.log("  /mcp/corsair → 4 tools (corsair_setup, list_operations, get_schema, run_script)");
console.log("  /mcp         → 55 Thread domain tools");

section("⚙️  PLATFORM");
console.log("  /api/corsair | /connect/* | /corsair/approve/:token");

section("⚠️  EXTRA casts (not in official SDK)");
for (const e of [
  "gmail.api.users.getProfile",
  "gmail.api.users.history.list",
  "googlecalendar.api.events.patch",
  "googlecalendar.api.events.watch",
  "googlecalendar.api.users.watch",
  "googlecalendar.api.users.history.list",
]) {
  console.log(`  ${e}`);
}

section("🔌 RUNTIME createCorsair() — live method tree");
console.log(`  Configured: ${isCorsairConfigured()}`);
if (isCorsairConfigured()) {
  const c = getCorsair();
  console.log(`  Root: ${Object.keys(c).filter((k) => !k.startsWith("_")).sort().join(", ")}`);

  const manage = collectFns(c.manage, "manage").sort();
  console.log(`\n  manage (${manage.length}):`);
  for (const fn of manage) console.log(`    ${fn}`);

  // Plugins bind on withTenant(), not the root instance.
  let tenantId = process.env.CORSAIR_AUDIT_TENANT_ID?.trim() ?? "";
  if (!tenantId) {
    try {
      const pool = getCorsairPool();
      const res = await pool.query<{ id: string }>(
        `SELECT id FROM users ORDER BY created_at DESC LIMIT 1`,
      );
      tenantId = res.rows[0]?.id ?? "";
    } catch {
      tenantId = "";
    }
  }

  if (tenantId) {
    console.log(`\n  withTenant("${tenantId.slice(0, 8)}…"):`);
    const tenant = c.withTenant(tenantId);
    console.log(`    keys: ${Object.keys(tenant).filter((k) => !k.startsWith("_")).sort().join(", ")}`);

    for (const plugin of ["gmail", "googlecalendar"] as const) {
      const p = tenant[plugin];
      console.log(`\n    [${plugin}]`);
      for (const layer of ["api", "db", "webhooks"] as const) {
        const fns = collectFns(p?.[layer], `${plugin}.${layer}`).sort();
        console.log(`      ${layer} (${fns.length}):`);
        for (const fn of fns) console.log(`        ${fn}`);
      }
    }
  } else {
    console.log("\n  withTenant: skipped (no tenant in corsair_tenants — connect Gmail/Calendar first)");
  }
}

section("✅ TOTALS");
console.log(`  Official API:     ${gmailOps.length + calOps.length}`);
console.log("  DB search:        6");
console.log("  Webhooks:         2 plugin + 3 HTTP routes");
console.log("  MCP:              4 official + 55 Thread");
console.log("  API hooks:        5");
console.log("");
}

void main();
