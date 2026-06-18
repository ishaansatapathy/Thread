"use strict";

/** Lightweight health probe — no bundled deps. Used when the main handler is cold-starting. */
module.exports = (_req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify({
      healthy: true,
      ready: false,
      service: "thread-api",
      message: "Thread API edge health — use /ready after cold start for DB check",
    }),
  );
};
