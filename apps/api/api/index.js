"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function requestPath(req) {
  const url = req.url ?? "/";
  const pathname = url.split("?")[0] || "/";
  const headers = req.headers ?? {};
  const invokePath = headers["x-vercel-sc-path"] || headers["x-invoke-path"];
  if (pathname === "/api" && typeof invokePath === "string" && invokePath.length > 0) {
    return invokePath.split("?")[0] || "/";
  }
  return pathname;
}

function withPath(req, pathname) {
  const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  req.url = pathname + query;
}

const BUNDLE_CANDIDATES = [
  path.join(__dirname, "dist", "vercel.mjs"),
  path.join(__dirname, "_bundle.mjs"),
];

function resolveBundlePath() {
  for (const candidate of BUNDLE_CANDIDATES) {
    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

// Static read helps Vercel Node File Trace include the bundle directory.
let tracedBundlePath = resolveBundlePath();
if (tracedBundlePath) {
  try {
    fs.statSync(tracedBundlePath);
  } catch {
    tracedBundlePath = null;
  }
}

let handler = null;

async function loadHandler() {
  if (handler) return handler;

  const resolved = tracedBundlePath ?? resolveBundlePath();
  if (!resolved) {
    throw new Error(
      `Serverless bundle missing after build (expected api/dist/vercel.mjs). Checked: ${BUNDLE_CANDIDATES.join(", ")}`,
    );
  }

  const mod = await import(pathToFileURL(resolved).href);
  const fn = mod.default ?? mod;
  if (typeof fn !== "function") {
    throw new Error("Serverless bundle must export a default async function");
  }
  handler = fn;
  return handler;
}

module.exports = async (req, res) => {
  try {
    const pathname = requestPath(req);

    if (pathname === "/health" || pathname === "/" || pathname === "/ping" || pathname === "/api") {
      sendJson(res, 200, {
        healthy: true,
        ready: Boolean(handler),
        bundle: Boolean(tracedBundlePath ?? resolveBundlePath()),
        message: handler
          ? "Thread API is healthy"
          : "Thread API is starting — wait a few seconds and retry",
      });
      return;
    }

    const fn = await loadHandler();
    if (req.url?.split("?")[0] === "/api" && pathname !== "/api") {
      withPath(req, pathname);
    }
    await fn(req, res);
  } catch (err) {
    if (res.headersSent) return;
    sendJson(res, 503, {
      ok: false,
      error: "Thread API unavailable",
      message: err instanceof Error ? err.message : String(err),
      hint: "Confirm Vercel Root Directory is apps/api, build log shows vercel-postbuild, and env vars are set (see apps/api/VERCEL_DEPLOY.md)",
    });
  }
};
