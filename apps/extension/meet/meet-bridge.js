// Isolated-world relay between the Thread side panel and meet-voice.js in Meet's page.
// Only the extension can send commands here; the page only ever reports state back.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "thread:voice") return;
  window.postMessage({ __threadToPage: "voice", action: message.action, audio: message.audio, gainDb: message.gainDb }, window.location.origin);
  sendResponse({ ok: true });
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.__threadFromPage !== "voice") return;
  chrome.runtime.sendMessage({ type: "thread:voice-state", armed: Boolean(data.armed), senders: data.senders ?? 0, error: data.error ?? null }).catch(() => {});
});
