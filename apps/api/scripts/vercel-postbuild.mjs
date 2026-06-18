/**
 * Copy dist/ beside api/index.js so Vercel serverless can resolve bundled assets.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "dist");
const dest = join(root, "api", "dist");

if (!existsSync(join(src, "vercel.js"))) {
  console.error("[vercel-postbuild] Missing dist/vercel.js — run tsup first");
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[vercel-postbuild] Copied dist/ → api/dist/");
