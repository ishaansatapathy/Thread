/**
 * Copy dist/ beside api/index.js so Vercel serverless can resolve bundled assets.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "dist");
const dest = join(root, "api", "dist");
const fallback = join(root, "api", "_bundle.mjs");

const vercelMjs = join(src, "vercel.mjs");
const vercelJs = join(src, "vercel.js");

if (!existsSync(vercelMjs) && !existsSync(vercelJs)) {
  console.error("[vercel-postbuild] Missing dist/vercel.mjs — run tsup first");
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

const bundleSrc = existsSync(vercelMjs) ? vercelMjs : vercelJs;
copyFileSync(bundleSrc, fallback);
console.log(`[vercel-postbuild] Copied dist/ → api/dist/ (+ api/_bundle.mjs fallback)`);

if (!existsSync(join(dest, "vercel.mjs"))) {
  console.error("[vercel-postbuild] Missing api/dist/vercel.mjs");
  process.exit(1);
}
