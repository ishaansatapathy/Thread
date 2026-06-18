"use strict";

let handler = null;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function loadHandler() {
  if (handler) return handler;

  // Statically require the bundle so that Vercel Node File Trace (NFT)
  // parses the import chain and includes external dependencies in the function deployment.
  const mod = require("./dist/vercel.js");
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
