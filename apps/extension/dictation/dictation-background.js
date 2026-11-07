// Voice dictation: the user focuses a text box on any page and starts dictating from the page
// (shortcut or Captain's menu). This service-worker module owns the one active session: it runs the
// hidden recorder page, sends each spoken phrase to Gnani (through Thread) and hands the text back
// to the tab in order. Nothing records until the user starts it, and it stops by itself on silence,
// on navigation, or when the tab closes.
import { AuthError, api, getAuth } from "../lib/api.js";
import { meetCodeFromUrl } from "../config.js";

const OFFSCREEN_URL = "dictation/offscreen.html";
const IDLE_STOP_MS = 60_000;
const MAX_SESSION_MS = 5 * 60_000;

/** @type {{ tabId: number, language: string, startedAt: number, lastChunkAt: number, queue: Promise<void>, timer: number, stopping: boolean } | null} */
let session = null;

function toBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function tell(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification: "Record the microphone while the user dictates into a text box.",
  });
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    /* already closed */
  }
}

async function setBadge(tabId, active) {
  try {
    if (active) {
      await chrome.action.setBadgeText({ tabId, text: "MIC" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#ef4444" });
      return;
    }
    const tab = await chrome.tabs.get(tabId);
    await chrome.action.setBadgeText({ tabId, text: meetCodeFromUrl(tab.url) ? "•" : "" });
    if (meetCodeFromUrl(tab.url)) await chrome.action.setBadgeBackgroundColor({ tabId, color: "#3b6cf6" });
  } catch {
    /* the tab is gone */
  }
}

async function dictationLanguage(requested) {
  if (typeof requested === "string" && /^[a-z]{2}-IN$/.test(requested)) return requested;
  const stored = await chrome.storage.local.get(["dictationLanguage", "language"]);
  return stored.dictationLanguage ?? stored.language ?? "en-IN";
}

async function start(tabId, requestedLanguage) {
  if (session) await stop("replaced");
  if (!(await getAuth())) {
    await tell(tabId, { type: "captain:dictation-state", state: "error", needsConnect: true, message: "Connect Thread first." });
    return;
  }
  const language = await dictationLanguage(requestedLanguage);
  try {
    await ensureOffscreen();
  } catch (error) {
    await tell(tabId, { type: "captain:dictation-state", state: "error", message: "Couldn't start the recorder." });
    console.warn("dictation offscreen failed", error);
    return;
  }
  const reply = await chrome.runtime.sendMessage({ target: "offscreen", type: "dictation:start" }).catch(() => null);
  if (!reply?.ok) {
    await closeOffscreen();
    if (reply?.error === "permission") {
      chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
      await tell(tabId, {
        type: "captain:dictation-state",
        state: "error",
        message: "Allow the microphone in the tab that just opened, then start dictation again.",
      });
    } else {
      await tell(tabId, { type: "captain:dictation-state", state: "error", message: "Couldn't reach your microphone." });
    }
    return;
  }

  const now = Date.now();
  session = {
    tabId,
    language,
    startedAt: now,
    lastChunkAt: now,
    queue: Promise.resolve(),
    stopping: false,
    timer: setInterval(() => {
      if (!session) return;
      if (Date.now() - session.startedAt > MAX_SESSION_MS) void stop("limit");
      else if (Date.now() - session.lastChunkAt > IDLE_STOP_MS) void stop("silence");
    }, 5000),
  };
  await setBadge(tabId, true);
  await tell(tabId, { type: "captain:dictation-state", state: "listening", language });
}

export async function stop(reason = "user") {
  const current = session;
  if (!current || current.stopping) return;
  current.stopping = true;
  clearInterval(current.timer);
  // Flush the phrase being spoken, then wait for every clip to be transcribed and delivered.
  await chrome.runtime.sendMessage({ target: "offscreen", type: "dictation:stop" }).catch(() => {});
  await current.queue.catch(() => {});
  await closeOffscreen();
  if (session === current) session = null;
  await setBadge(current.tabId, false);
  await tell(current.tabId, { type: "captain:dictation-state", state: "idle", reason });
}

function transcribeChunk(current, base64) {
  current.lastChunkAt = Date.now();
  current.queue = current.queue.then(async () => {
    try {
      const text = await api.transcribe(toBytes(base64), current.language);
      if (text.trim()) await tell(current.tabId, { type: "captain:dictation-text", text: text.trim() });
    } catch (error) {
      if (error instanceof AuthError) {
        await tell(current.tabId, { type: "captain:dictation-state", state: "error", needsConnect: true, message: error.message });
        void stop("auth");
      } else if (error?.status === 412) {
        await tell(current.tabId, { type: "captain:dictation-state", state: "error", message: "Voice typing isn't set up on the Thread server." });
        void stop("server");
      }
      /* a single failed phrase is skipped; the next one may be fine */
    }
  });
}

/** Messages from the page (start/stop/language) and from the recorder page (clips, levels). */
export function handleDictationMessage(message, sender, sendResponse) {
  const type = message?.type;
  if (typeof type !== "string" || !type.startsWith("dictation:")) return false;
  if (sender.id !== chrome.runtime.id) return false;

  if (type === "dictation:chunk" && message.target === "background") {
    if (session && !session.stopping && typeof message.wav === "string") transcribeChunk(session, message.wav);
    return false;
  }
  if (type === "dictation:level" && message.target === "background") {
    if (session && !session.stopping) tell(session.tabId, { type: "captain:dictation-level", level: Number(message.level) || 0 });
    return false;
  }

  const tabId = sender.tab?.id;
  if (tabId == null) return false;
  if (type === "dictation:start") {
    start(tabId, message.language).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (type === "dictation:stop") {
    if (session?.tabId === tabId) stop("user").then(() => sendResponse({ ok: true }));
    else sendResponse({ ok: true });
    return true;
  }
  if (type === "dictation:language" && session?.tabId === tabId && /^[a-z]{2}-IN$/.test(String(message.language))) {
    session.language = message.language;
    chrome.storage.local.set({ dictationLanguage: message.language });
  }
  return false;
}

export function watchDictationTabs() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (session?.tabId === tabId) void stop("closed");
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // A new page (not a same-page change) ends the session; its text box no longer exists.
    if (session?.tabId === tabId && changeInfo.status === "loading" && changeInfo.url) void stop("navigated");
  });
}
