import {
  handleCaptainMenuClick,
  handleCaptainMessage,
  handleCaptainPort,
  registerCaptainMenus,
  sendToCaptain,
} from "./captain/captain-background.js";
import { isAllowedOrigin, meetCodeFromUrl } from "./config.js";

// The auth token lives in storage.local; keep it out of reach of content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

// Clicking the toolbar icon opens the Thread side panel (and grants tab capture for that tab).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  registerCaptainMenus();
});

// Captain Thread: settings + "ask" streaming for the in-page assistant.
chrome.runtime.onMessage.addListener(handleCaptainMessage);
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "captain") handleCaptainPort(port);
});
chrome.contextMenus.onClicked.addListener(handleCaptainMenuClick);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "captain-area" && tab?.id) sendToCaptain(tab.id, { type: "captain:area" });
});

// The Thread web app hands us a token from its "Connect extension" page. The base URL is
// taken from the verified sender origin, never from the message, so a page can't redirect
// our token somewhere else.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedOrigin(sender.origin)) {
    sendResponse({ ok: false, error: "This site can't connect to the Thread extension." });
    return;
  }
  if (message?.type === "thread:ping") {
    chrome.storage.local.get("auth").then(({ auth }) => {
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version, connected: Boolean(auth?.token) });
    });
    return true;
  }
  if (message?.type === "thread:connect" && typeof message.token === "string" && message.token.length > 20) {
    const auth = {
      token: message.token,
      baseUrl: sender.origin,
      email: typeof message.email === "string" ? message.email : null,
      name: typeof message.name === "string" ? message.name : null,
      expiresAt: typeof message.expiresAt === "string" ? message.expiresAt : null,
    };
    chrome.storage.local.set({ auth, lastBaseUrl: sender.origin }).then(() => sendResponse({ ok: true }));
    return true;
  }
  sendResponse({ ok: false, error: "Unknown message" });
});

// A small "Meet" hint on the icon whenever the user is in a Meet call.
function updateBadge(tabId, url) {
  const inMeet = Boolean(meetCodeFromUrl(url));
  chrome.action.getBadgeText({ tabId }).then((text) => {
    if (text === "LIVE") return; // the side panel owns the badge while recording
    chrome.action.setBadgeText({ tabId, text: inMeet ? "•" : "" }).catch(() => {});
    if (inMeet) chrome.action.setBadgeBackgroundColor({ tabId, color: "#3b6cf6" }).catch(() => {});
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") updateBadge(tabId, tab.url);
});
