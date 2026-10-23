// Captain Thread's side of the service worker: settings, opening Thread pages, and the
// streaming "ask" port. Content scripts never see the auth token — every API call is made
// here, and the page URL/title come from Chrome (port.sender), not from the page.

import { THREAD_ORIGINS } from "../config.js";
import { AuthError, api, getAuth } from "../lib/api.js";
import { renderMarkdown } from "../lib/markdown.js";

const DEFAULTS = { dock: true, selection: true, offSites: [], dockY: 0.74, greeted: false };
const MAX_TEXT = 6000;
const MAX_QUESTION = 4000;
const SOURCES = ["selection", "area", "page"];
const CONTENT_FILES = ["captain/captain-art.js", "captain/captain.js"];

export async function captainSettings() {
  const { captain } = await chrome.storage.local.get("captain");
  return { ...DEFAULTS, ...(captain ?? {}) };
}

async function updateSettings(patch) {
  const current = await captainSettings();
  const next = { ...current, ...patch, offSites: [...new Set(patch.offSites ?? current.offSites)].slice(-200) };
  await chrome.storage.local.set({ captain: next });
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "captain:settings", settings: next }).catch(() => {});
  }
  return next;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function webBase() {
  const auth = await getAuth();
  if (auth?.baseUrl) return auth.baseUrl;
  const { lastBaseUrl } = await chrome.storage.local.get("lastBaseUrl");
  return lastBaseUrl ?? THREAD_ORIGINS[0].origin;
}

/** Tabs opened before the extension was installed/updated have no content script yet. */
export async function ensureCaptainInTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "captain:ping" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  }
}

export async function sendToCaptain(tabId, message) {
  try {
    await ensureCaptainInTab(tabId);
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // chrome:// pages, the Web Store and PDFs can't host content scripts — nothing to do.
  }
}

/** One-shot messages from content scripts and the side panel. Returns true when replying async. */
export function handleCaptainMessage(message, sender, sendResponse) {
  const type = message?.type;
  if (typeof type !== "string" || !type.startsWith("captain:")) return false;

  const reply = (work) => {
    work.then(sendResponse, (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  };

  if (type === "captain:init") {
    return reply(
      Promise.all([captainSettings(), getAuth()]).then(([settings, auth]) => ({
        ok: true,
        settings,
        connected: Boolean(auth),
        name: auth?.name ?? null,
      })),
    );
  }

  if (type === "captain:set") {
    return reply(
      (async () => {
        const patch = {};
        if (typeof message.dock === "boolean") patch.dock = message.dock;
        if (typeof message.selection === "boolean") patch.selection = message.selection;
        if (message.greeted === true) patch.greeted = true;
        if (Number.isFinite(message.dockY)) patch.dockY = Math.min(0.95, Math.max(0.05, message.dockY));
        if (message.resetSites === true) patch.offSites = [];
        if (typeof message.siteOff === "boolean") {
          // A content script can only switch its own site; the side panel names one explicitly.
          const host = sender.tab ? hostOf(sender.tab.url) : typeof message.host === "string" ? message.host : null;
          if (host) {
            const { offSites } = await captainSettings();
            patch.offSites = message.siteOff ? [...offSites, host] : offSites.filter((h) => h !== host);
          }
        }
        return { ok: true, settings: await updateSettings(patch) };
      })(),
    );
  }

  if (type === "captain:connect") {
    return reply(webBase().then((base) => chrome.tabs.create({ url: `${base}/connect-extension` })).then(() => ({ ok: true })));
  }

  if (type === "captain:open") {
    return reply(
      webBase().then(async (base) => {
        const prompt = typeof message.prompt === "string" ? message.prompt.slice(0, 1800) : "";
        const url = message.page === "queue" ? `${base}/queue` : `${base}/agent${prompt ? `?prompt=${encodeURIComponent(prompt)}` : ""}`;
        await chrome.tabs.create({ url, index: sender.tab ? sender.tab.index + 1 : undefined });
        return { ok: true };
      }),
    );
  }

  return false;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
}

/** Streams one answer to the content script over a long-lived port named "captain". */
export function handleCaptainPort(port) {
  const tab = port.sender?.tab;
  if (!tab) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  let closed = false;
  port.onDisconnect.addListener(() => {
    closed = true;
    controller.abort();
  });
  const post = (message) => {
    if (closed) return;
    try {
      port.postMessage(message);
    } catch {
      closed = true;
    }
  };

  port.onMessage.addListener(async (message) => {
    if (message?.type !== "ask") return;
    const question = String(message.question ?? "").trim().slice(0, MAX_QUESTION);
    if (!question) return post({ type: "error", message: "Ask something first." });

    const auth = await getAuth();
    if (!auth) return post({ type: "error", needsConnect: true, message: "Connect Captain Thread to your Thread account first." });

    const text = String(message.page?.text ?? "").trim().slice(0, MAX_TEXT);
    const pageUrl = port.sender.url ?? tab.url ?? "";
    const pageContext =
      text && /^https?:\/\//.test(pageUrl)
        ? {
            url: pageUrl.slice(0, 2000),
            title: tab.title?.trim().slice(0, 300) || undefined,
            text,
            source: SOURCES.includes(message.page?.source) ? message.page.source : "selection",
          }
        : undefined;

    let reply = "";
    let timer = null;
    const flush = () => {
      timer = null;
      post({ type: "delta", html: renderMarkdown(reply) });
    };

    try {
      const result = await api.agent(
        {
          message: question,
          history: cleanHistory(message.history),
          toolMemory: Array.isArray(message.toolMemory) ? message.toolMemory.slice(-12) : [],
          pageContext,
          email: auth.email,
        },
        {
          signal: controller.signal,
          onStatus: (label) => post({ type: "status", label }),
          onToken: (delta) => {
            reply += delta;
            timer ??= setTimeout(flush, 60);
          },
        },
      );
      clearTimeout(timer);
      const finalText = result.reply || reply;
      post({
        type: "done",
        text: finalText,
        html: renderMarkdown(finalText),
        actions: (result.actions ?? []).map((a) => ({ title: String(a.title ?? "Action ready"), detail: a.detail ? String(a.detail) : "" })),
        toolMemory: result.toolMemory ?? [],
      });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) return;
      post({
        type: "error",
        needsConnect: error instanceof AuthError,
        message: error?.message || "Captain couldn't answer that — try again.",
      });
    }
  });
}

export function registerCaptainMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "captain-ask", title: "Ask Captain Thread about “%s”", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "captain-area", title: "Draw around something to ask Captain Thread", contexts: ["page", "image", "link"] });
  });
}

export function handleCaptainMenuClick(info, tab) {
  if (!tab?.id) return;
  if (info.menuItemId === "captain-ask") sendToCaptain(tab.id, { type: "captain:ask", text: info.selectionText ?? "" });
  if (info.menuItemId === "captain-area") sendToCaptain(tab.id, { type: "captain:area" });
}
