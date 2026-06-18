"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

/** createRequire needs a FILE path — __dirname alone breaks relative resolution. */
const requireFromHere = createRequire(path.join(__dirname, "index.js"));

let handler = null;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function resolveHandlerPath() {
  const candidates = [
    path.join(__dirname, "dist", "vercel.js"),
    path.join(__dirname, "..", "dist", "vercel.js"),
    path.join(process.cwd(), "dist", "vercel.js"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function loadHandler() {
  if (handler) return handler;

  const handlerPath = resolveHandlerPath();
  if (!handlerPath) {
    throw new Error(
      "Serverless bundle missing (api/dist/vercel.js). Build must run: pnpm --filter @repo/api build",
    );
  }

  const mod = requireFromHere(handlerPath);
  const fn = mod.default ?? mod;
  if (typeof fn !== "function") {
    throw new Error("Serverless bundle must export a default async function");
  }
  handler = fn;
  return handler;
}

module.exports = async (req, res) => {
  try {
    const fn = await loadHandler();
    await fn(req, res);
  } catch (err) {
    if (res.headersSent) return;
    sendJson(res, 503, {
      ok: false,
      error: "Thread API unavailable",
      message: err instanceof Error ? err.message : String(err),
      hint: "Verify Vercel build + env: DATABASE_URL, JWT_SECRET, CORSAIR_KEK, BASE_URL, CLIENT_URL",
    });
  }
};
