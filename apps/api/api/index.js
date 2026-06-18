"use strict";

const { createRequire } = require("node:module");

const requireDist = createRequire(__dirname);

/** @type {((req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>) | null} */
let handler = null;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  try {
    handler ??= requireDist("../dist/vercel.js").default;
    await handler(req, res);
  } catch (err) {
    if (res.headersSent) return;
    sendJson(res, 503, {
      ok: false,
      error: "Thread API handler failed to load",
      message: err instanceof Error ? err.message : String(err),
      hint: "Ensure pnpm build ran and dist/vercel.js exists in the deployment",
    });
  }
};
