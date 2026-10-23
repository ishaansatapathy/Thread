import { THREAD_ORIGINS, isAllowedOrigin, meetCodeFromUrl } from "./config.js";
import { AuthError, api, clearAuth, getAuth } from "./lib/api.js";
import { TARGET_SAMPLE_RATE, VoiceActivityChunker, concat, downsample, encodeWav, tapStream, trimSilence } from "./lib/audio.js";
import { renderMarkdown } from "./lib/markdown.js";

const LANGUAGES = [
  ["en-IN", "English"],
  ["hi-IN", "Hindi / Hinglish"],
  ["bn-IN", "Bengali"],
  ["ta-IN", "Tamil"],
  ["te-IN", "Telugu"],
  ["kn-IN", "Kannada"],
  ["ml-IN", "Malayalam"],
  ["mr-IN", "Marathi"],
  ["gu-IN", "Gujarati"],
  ["pa-IN", "Punjabi"],
];

const NOTE_ACTIONS = [
  ["Email the notes", "Draft a follow-up email for this meeting with a 2-line summary, the decisions and the action items with owners. Ask me who to send it to if you can't tell."],
  ["Save as Google Doc", "Create a Google Doc of this meeting's notes: summary, key points, decisions, and an action items table."],
  ["Action items → Sheet", "Create a Google Sheet tracker of this meeting's action items with columns Action, Owner, Deadline, Status."],
  ["Schedule follow-up", "Propose a follow-up meeting for this meeting's open items and queue a calendar invite with a Meet link."],
  ["Post to Classroom", "Turn this meeting/lecture into a short Classroom announcement with the key points and any assignments, for the right course."],
];

const ASK_CHIPS = ["What did I miss in the last 5 minutes?", "What has been decided so far?", "Who owns which action item?", "Summarise this in Hindi"];

const MAX_UPLOADS = 3;
const NOTES_POLL_MS = 25_000;

const app = document.getElementById("app");
const accountEl = document.getElementById("account");

const state = {
  auth: null,
  tab: null, // active tab in this window
  meetCode: null,
  meeting: null, // raw meeting row from the API
  meetingLoading: false,
  segments: [],
  panel: "captions",
  language: "en-IN",
  includeMic: true,
  notice: null,
  capture: null, // { tabId, meetingId, startedAt, ctx, taps, streams, chunkers, queue, inFlight, failed, levels, fatal }
  ask: { messages: [], pending: false, status: null, actions: [], toolMemory: [], abort: null, draft: "" },
  recent: null,
  gnaniReady: true,
};

// ── tiny DOM helper (text is always set via textContent) ─────────────────────
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "html") node.innerHTML = value; // only ever renderMarkdown() output
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function speakerName(id) {
  return id === "you" ? "You" : id === "meeting" ? "Meeting" : id === "room" ? "Room" : `Speaker ${id}`;
}

function meetUrlFor(code) {
  return `https://meet.google.com/${code}`;
}

function sortedSegments() {
  const seen = new Set();
  return state.segments
    .filter((s) => {
      const key = `${s.speakerId}|${s.startTime}|${s.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startTime - b.startTime);
}

function setNotice(text, kind = "info") {
  state.notice = text ? { text, kind } : null;
  render();
}

// ── data loading ─────────────────────────────────────────────────────────────
async function loadAuth() {
  state.auth = await getAuth();
  accountEl.textContent = state.auth?.email ?? "";
  if (state.auth) {
    api.speechStatus()
      .then((s) => {
        state.gnaniReady = Boolean(s.configured);
        render();
      })
      .catch((error) => {
        if (error instanceof AuthError) onAuthLost(error);
      });
  }
}

function onAuthLost(error) {
  state.auth = null;
  accountEl.textContent = "";
  setNotice(error.message, "error");
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab ?? null;
  const code = meetCodeFromUrl(tab?.url);
  // While recording, stay on the call being captured even if the user switches tabs.
  if (state.capture) return render();
  if (code !== state.meetCode) {
    state.meetCode = code;
    state.meeting = null;
    state.segments = [];
    state.ask = { messages: [], pending: false, status: null, actions: [], toolMemory: [], abort: null, draft: "" };
    if (code && state.auth) await loadMeetingForCall(code);
    else if (!code && state.auth) loadRecent();
  }
  render();
}

async function loadMeetingForCall(code) {
  state.meetingLoading = true;
  render();
  try {
    const meetings = await api.meetingsForCall(meetUrlFor(code));
    const open = meetings.find((m) => m.status === "live" || m.status === "pending");
    const meeting = open ?? meetings[0] ?? null;
    setMeeting(meeting);
  } catch (error) {
    if (error instanceof AuthError) onAuthLost(error);
    else setNotice(error.message, "error");
  } finally {
    state.meetingLoading = false;
    render();
  }
}

function setMeeting(meeting) {
  state.meeting = meeting;
  state.segments = Array.isArray(meeting?.segmentsJson) ? [...meeting.segmentsJson] : [];
  if (meeting?.languageCode && LANGUAGES.some(([c]) => c === meeting.languageCode)) state.language = meeting.languageCode;
}

async function refreshMeeting() {
  if (!state.meeting) return;
  try {
    const meeting = await api.getMeeting(state.meeting.id);
    const live = state.segments;
    setMeeting(meeting);
    // Keep any lines that arrived after this read was issued.
    state.segments = [...state.segments, ...live];
    render();
  } catch (error) {
    if (error instanceof AuthError) onAuthLost(error);
  }
}

async function loadRecent() {
  try {
    state.recent = (await api.recentMeetings()).slice(0, 8);
    render();
  } catch (error) {
    if (error instanceof AuthError) onAuthLost(error);
  }
}

// ── capture ─────────────────────────────────────────────────────────────────
async function startCapture({ fresh = false } = {}) {
  const tab = state.tab;
  const code = meetCodeFromUrl(tab?.url);
  if (!tab?.id || !code) return;

  // Must be the first await in the click handler: Chrome only hands out a tab stream
  // right after the user invoked the extension on this tab.
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch {
    setNotice("Chrome needs one click on the Thread icon in the toolbar while this Meet tab is open (or press Alt+Shift+T). Then press Start.", "error");
    return;
  }

  setNotice(null);
  let meeting = state.meeting;
  try {
    if (!meeting || fresh || meeting.status === "ready" || meeting.status === "failed") {
      meeting = await api.createMeeting({
        mode: "live",
        meetUrl: meetUrlFor(code),
        languageCode: state.language,
        title: tab.title && !/^meet\b/i.test(tab.title) ? tab.title.replace(/\s*[-|–]\s*Google Meet\s*$/i, "").slice(0, 200) : undefined,
      });
      setMeeting(meeting);
    }
  } catch (error) {
    if (error instanceof AuthError) return onAuthLost(error);
    return setNotice(error.message, "error");
  }

  const ctx = new AudioContext();
  const capture = {
    tabId: tab.id,
    meetingId: meeting.id,
    startedAt: Date.now(),
    ctx,
    taps: [],
    streams: [],
    chunkers: [],
    queue: [],
    inFlight: 0,
    failed: 0,
    levels: { meeting: 0, you: 0 },
    sources: { meeting: false, you: false },
    fatal: false,
    drainWaiters: [],
  };
  const lastEnd = state.segments.reduce((max, s) => Math.max(max, s.endTime ?? 0), 0);
  const baseOffsetSec = lastEnd > 0 ? Math.ceil(lastEnd) + 1 : 0;
  capture.baseOffsetSec = baseOffsetSec;

  const attach = async (stream, speaker) => {
    const chunker = new VoiceActivityChunker({
      sampleRate: ctx.sampleRate,
      baseOffsetSec,
      onChunk: (chunk) => enqueue(capture, chunk, speaker),
      onLevel: (level) => {
        capture.levels[speaker] = level;
      },
    });
    capture.chunkers.push(chunker);
    capture.taps.push(await tapStream(stream, (frames) => chunker.push(frames), ctx));
    capture.streams.push(stream);
    capture.sources[speaker] = true;
  };

  try {
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false,
    });
    // Capturing a tab mutes it for the user — play it back so the call stays audible.
    ctx.createMediaStreamSource(tabStream).connect(ctx.destination);
    await attach(tabStream, "meeting");
  } catch (error) {
    await ctx.close().catch(() => {});
    return setNotice(`Couldn't capture the Meet tab: ${error.message}`, "error");
  }

  if (state.includeMic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      await attach(mic, "you");
    } catch {
      chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
      setNotice("Transcribing the call without your mic — allow microphone access in the tab that just opened, then Pause → Start to add it.", "info");
    }
  }

  state.capture = capture;
  chrome.action.setBadgeText({ tabId: tab.id, text: "LIVE" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#ef4444" }).catch(() => {});
  capture.timer = setInterval(() => renderLiveBits(), 250);
  capture.notesTimer = setInterval(() => refreshMeeting(), NOTES_POLL_MS);
  render();
}

function enqueue(capture, chunk, speaker) {
  capture.queue.push({ chunk, speaker });
  pump(capture);
}

function pump(capture) {
  while (capture.inFlight < MAX_UPLOADS && capture.queue.length && !capture.fatal) {
    const job = capture.queue.shift();
    capture.inFlight++;
    api
      .uploadChunk(capture.meetingId, job.chunk, job.speaker, state.language)
      .then((segment) => {
        if (segment && state.meeting?.id === capture.meetingId) {
          state.segments.push(segment);
          renderCaptionsIfVisible();
        }
      })
      .catch((error) => {
        if (error instanceof AuthError) {
          capture.fatal = true;
          onAuthLost(error);
          stopCapture();
        } else if (error.status === 412 || error.status === 409) {
          capture.fatal = true;
          setNotice(error.status === 412 ? "Gnani isn't configured on the server (GNANI_API_KEY)." : error.message, "error");
          stopCapture();
        } else {
          capture.failed++;
        }
      })
      .finally(() => {
        capture.inFlight--;
        if (capture.inFlight === 0 && capture.queue.length === 0) capture.drainWaiters.splice(0).forEach((r) => r());
        pump(capture);
      });
  }
}

async function stopCapture() {
  const capture = state.capture;
  if (!capture) return;
  state.capture = null;
  clearInterval(capture.timer);
  clearInterval(capture.notesTimer);
  capture.chunkers.forEach((c) => c.finish());
  capture.taps.forEach((t) => t.stop());
  capture.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  chrome.action.setBadgeText({ tabId: capture.tabId, text: "•" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId: capture.tabId, color: "#3b6cf6" }).catch(() => {});
  render();
  if (capture.inFlight || capture.queue.length) await new Promise((resolve) => capture.drainWaiters.push(resolve));
  await capture.ctx.close().catch(() => {});
  await refreshMeeting();
  await refreshActiveTab();
}

async function endMeeting() {
  if (!state.meeting) return;
  await stopCapture();
  try {
    setMeeting(await api.endMeeting(state.meeting.id));
    state.panel = "notes";
  } catch (error) {
    if (error instanceof AuthError) return onAuthLost(error);
    setNotice(error.message, "error");
  }
  render();
}

// ── Ask Thread ──────────────────────────────────────────────────────────────
async function ask(text) {
  const message = text.trim();
  const a = state.ask;
  if (!message || a.pending || !state.meeting) return;
  const history = a.messages.slice(-10);
  a.messages.push({ role: "user", content: message });
  a.pending = true;
  a.status = null;
  a.actions = [];
  state.panel = "ask";
  render();

  const abort = new AbortController();
  a.abort = abort;
  let streamed = "";
  try {
    const result = await api.agent(
      { message, history, toolMemory: a.toolMemory, meetingId: state.meeting.id, email: state.auth?.email },
      {
        signal: abort.signal,
        onStatus: (label) => {
          a.status = label;
          renderAskIfVisible();
        },
        onToken: (token) => {
          streamed += token;
          const last = a.messages.at(-1);
          if (last?.role === "assistant") last.content = streamed;
          else a.messages.push({ role: "assistant", content: streamed });
          renderAskIfVisible();
        },
      },
    );
    const last = a.messages.at(-1);
    if (last?.role === "assistant") last.content = result.reply || streamed;
    else a.messages.push({ role: "assistant", content: result.reply });
    a.actions = result.actions ?? [];
    a.toolMemory = result.toolMemory ?? a.toolMemory;
  } catch (error) {
    if (error instanceof AuthError) onAuthLost(error);
    else if (error.name !== "AbortError") a.messages.push({ role: "assistant", content: `⚠️ ${error.message}` });
  } finally {
    a.pending = false;
    a.status = null;
    a.abort = null;
    render();
  }
}

// Push-to-talk for Ask: record the mic, trim silence, Gnani → text → ask.
const ptt = { active: false, frames: [], tap: null, stream: null, ctx: null, timer: null };

async function togglePushToTalk() {
  if (ptt.active) return finishPushToTalk();
  try {
    ptt.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
    return setNotice("Allow microphone access in the tab that just opened, then try the mic again.", "info");
  }
  ptt.ctx = new AudioContext();
  ptt.frames = [];
  ptt.tap = await tapStream(ptt.stream, (frames) => ptt.frames.push(frames), ptt.ctx);
  ptt.active = true;
  ptt.timer = setTimeout(() => finishPushToTalk(), 28_000);
  render();
}

async function finishPushToTalk() {
  if (!ptt.active) return;
  clearTimeout(ptt.timer);
  ptt.active = false;
  ptt.tap?.stop();
  ptt.stream?.getTracks().forEach((t) => t.stop());
  const rate = ptt.ctx?.sampleRate ?? 48000;
  await ptt.ctx?.close().catch(() => {});
  const samples = trimSilence(downsample(concat(ptt.frames), rate));
  ptt.frames = [];
  render();
  if (samples.length < TARGET_SAMPLE_RATE * 0.4) return setNotice("Didn't catch any speech — try again.", "info");
  try {
    const text = await api.transcribe(encodeWav(samples), state.language);
    if (text) ask(text);
    else setNotice("Couldn't make out any words.", "info");
  } catch (error) {
    if (error instanceof AuthError) onAuthLost(error);
    else setNotice(error.message, "error");
  }
}

// ── rendering ────────────────────────────────────────────────────────────────
function noticeView() {
  if (!state.notice) return null;
  return el(
    "div",
    { class: `notice notice-${state.notice.kind}` },
    el("span", {}, state.notice.text),
    el("button", { class: "link", type: "button", onclick: () => setNotice(null), "aria-label": "Dismiss" }, "×"),
  );
}

function connectView() {
  const code = el("textarea", { rows: 3, placeholder: "Paste the connection code from Thread" });
  return el(
    "section",
    { class: "card center" },
    el("h1", {}, "Connect your Thread account"),
    el("p", { class: "muted" }, "Thread shows live captions, running notes and your agent inside Google Meet. Connect once — it stays signed in for 30 days."),
    ...THREAD_ORIGINS.map(({ label, origin }) =>
      el("button", { class: "primary block", type: "button", onclick: () => chrome.tabs.create({ url: `${origin}/connect-extension` }) }, `Connect with ${label}`),
    ),
    el(
      "details",
      { class: "paste" },
      el("summary", {}, "Have a connection code?"),
      code,
      el(
        "button",
        {
          class: "secondary block",
          type: "button",
          onclick: async () => {
            try {
              const parsed = JSON.parse(atob(code.value.trim()));
              if (!parsed.token || !isAllowedOrigin(parsed.baseUrl)) throw new Error("bad code");
              await chrome.storage.local.set({ auth: { token: parsed.token, baseUrl: parsed.baseUrl, email: parsed.email ?? null, name: parsed.name ?? null } });
              await boot();
            } catch {
              setNotice("That code didn't work — copy it again from Thread.", "error");
            }
          },
        },
        "Connect with code",
      ),
    ),
  );
}

function idleView() {
  const recent = state.recent;
  return el(
    "section",
    {},
    el(
      "div",
      { class: "card" },
      el("h1", {}, "Open a Google Meet call"),
      el("p", { class: "muted" }, "Thread listens to the call with you: live multilingual captions by Gnani, notes that build themselves, and an agent you can talk to mid-meeting."),
      el("button", { class: "primary block", type: "button", onclick: () => chrome.tabs.create({ url: "https://meet.google.com/new" }) }, "Start a new Meet"),
      el("p", { class: "hint" }, "Already in a call? Switch to its tab — this panel follows you."),
    ),
    recent && recent.length
      ? el(
          "div",
          { class: "card" },
          el("h2", {}, "Recent meetings"),
          el(
            "ul",
            { class: "list" },
            recent.map((m) =>
              el(
                "li",
                {},
                el("a", { href: `${state.auth.baseUrl}/meet/${m.id}`, target: "_blank", rel: "noopener" }, m.title || "Untitled meeting"),
                el("span", { class: `pill pill-${m.status}` }, m.status === "ready" ? "notes" : m.status),
              ),
            ),
          ),
        )
      : null,
  );
}

function languageSelect() {
  return el(
    "select",
    {
      class: "lang",
      disabled: Boolean(state.capture),
      "aria-label": "Language people are speaking",
      onchange: (e) => {
        state.language = e.target.value;
        chrome.storage.local.set({ language: state.language });
      },
    },
    LANGUAGES.map(([code, label]) => el("option", { value: code, selected: code === state.language }, label)),
  );
}

function meetingView() {
  const meeting = state.meeting;
  const live = Boolean(state.capture);
  const ended = meeting && (meeting.status === "ready" || meeting.status === "failed");
  const segments = sortedSegments();

  const head = el(
    "div",
    { class: "room-head" },
    el(
      "div",
      { class: "room-title" },
      el("strong", {}, meeting?.title || state.meetCode),
      el("span", { class: `pill ${live ? "pill-live" : ended ? "pill-ready" : ""}`, id: "status-pill" }, live ? "● Live" : ended ? "Ended" : meeting ? "Paused" : "Not started"),
    ),
    languageSelect(),
  );

  let controls;
  if (state.meetingLoading) {
    controls = el("div", { class: "controls" }, el("span", { class: "muted" }, "Loading…"));
  } else if (state.gnaniReady === false) {
    controls = el("div", { class: "notice notice-error" }, "Live transcription needs GNANI_API_KEY on the Thread server.");
  } else if (live) {
    controls = el(
      "div",
      { class: "controls" },
      el("div", { class: "meters", id: "meters" }),
      el("span", { class: "stat", id: "live-stat" }),
      el("button", { class: "secondary", type: "button", onclick: () => stopCapture() }, "Pause"),
      el("button", { class: "danger", type: "button", onclick: () => endMeeting() }, "End"),
    );
  } else {
    controls = el(
      "div",
      { class: "controls" },
      el(
        "button",
        { class: "primary", type: "button", onclick: () => startCapture({ fresh: Boolean(ended) }) },
        ended ? "Start a new transcript" : meeting && segments.length ? "Resume transcript" : "Start live transcript",
      ),
      el(
        "label",
        { class: "check" },
        el("input", {
          type: "checkbox",
          checked: state.includeMic,
          onchange: (e) => {
            state.includeMic = e.target.checked;
            chrome.storage.local.set({ includeMic: state.includeMic });
          },
        }),
        "Include my mic",
      ),
      !ended && meeting && segments.length ? el("button", { class: "link", type: "button", onclick: () => endMeeting() }, "End meeting") : null,
    );
  }

  const tabs = el(
    "div",
    { class: "tabs", role: "tablist" },
    [
      ["captions", "Captions"],
      ["notes", "Notes"],
      ["ask", "Ask Thread"],
    ].map(([key, label]) =>
      el(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-selected": state.panel === key ? "true" : "false",
          class: state.panel === key ? "active" : "",
          onclick: () => {
            state.panel = key;
            render();
          },
        },
        label,
      ),
    ),
  );

  const body =
    state.panel === "captions" ? captionsView(segments, live) : state.panel === "notes" ? notesView() : askView();

  return el(
    "section",
    { class: "room" },
    head,
    controls,
    tabs,
    body,
    meeting
      ? el("a", { class: "open-full", href: `${state.auth.baseUrl}/meet/${meeting.id}`, target: "_blank", rel: "noopener" }, "Open full room in Thread ↗")
      : null,
  );
}

function captionsView(segments, live) {
  const list = el("div", { class: "captions", id: "captions" });
  if (!segments.length) {
    list.append(el("p", { class: "muted empty" }, live ? "Listening… lines appear a few seconds after each pause." : "Press Start — captions show up here."));
  }
  let prev = null;
  for (const s of segments) {
    const continued = prev && prev.speakerId === s.speakerId && s.startTime - prev.endTime < 20;
    list.append(
      el(
        "div",
        { class: `line speaker-${s.speakerId}${continued ? " continued" : ""}` },
        continued ? null : el("div", { class: "line-head" }, el("span", { class: "who" }, speakerName(s.speakerId)), el("span", { class: "when" }, clock(s.startTime))),
        el("p", {}, s.text),
      ),
    );
    prev = s;
  }
  queueMicrotask(() => {
    list.scrollTop = list.scrollHeight;
  });
  return list;
}

function notesView() {
  const notes = state.meeting?.notesJson;
  const total = state.meeting ? state.segments.length : 0;
  const covered = state.meeting?.summarizedCount ?? 0;
  const has = notes && (notes.summary || notes.keyPoints?.length || notes.actionItems?.length);
  return el(
    "div",
    { class: "notes" },
    el(
      "div",
      { class: "notes-head" },
      el("span", { class: "muted" }, has ? (total > covered ? `Covers ${covered} of ${total} lines` : "Up to date") : "Notes build up as people talk"),
      el(
        "button",
        {
          class: "link",
          type: "button",
          disabled: !state.meeting || total === 0,
          onclick: async () => {
            try {
              setMeeting(await api.refreshNotes(state.meeting.id));
              render();
            } catch (error) {
              setNotice(error.message, "error");
            }
          },
        },
        "Update",
      ),
    ),
    has ? el("p", { class: "summary" }, notes.summary) : null,
    has && notes.decisions?.length ? section("Decisions", notes.decisions.map((d) => el("li", {}, d))) : null,
    has && notes.actionItems?.length
      ? section(
          "Action items",
          notes.actionItems.map((a) => el("li", {}, a.action, a.owner || a.deadline ? el("em", {}, ` — ${[a.owner, a.deadline].filter(Boolean).join(" · ")}`) : null)),
        )
      : null,
    has && notes.keyPoints?.length ? section("Key points", notes.keyPoints.map((k) => el("li", {}, k))) : null,
    el(
      "div",
      { class: "actions-grid" },
      NOTE_ACTIONS.map(([label, prompt]) => el("button", { class: "secondary", type: "button", disabled: total === 0, onclick: () => ask(prompt) }, label)),
    ),
  );
}

function section(title, items) {
  return el("div", { class: "notes-section" }, el("h3", {}, title), el("ul", {}, items));
}

function askView() {
  const a = state.ask;
  const list = el("div", { class: "ask-list", id: "ask-list" });
  if (!a.messages.length) {
    list.append(
      el("p", { class: "muted" }, "Ask about the meeting, or tell Thread to act on it — email, Docs, Sheets, Calendar, Classroom. Changes wait in Queue."),
      el("div", { class: "chips" }, ASK_CHIPS.map((c) => el("button", { type: "button", disabled: !state.meeting, onclick: () => ask(c) }, c))),
    );
  }
  for (const m of a.messages) {
    list.append(m.role === "user" ? el("div", { class: "msg user" }, m.content) : el("div", { class: "msg assistant", html: renderMarkdown(m.content) }));
  }
  if (a.pending && a.messages.at(-1)?.role !== "assistant") list.append(el("div", { class: "msg assistant muted" }, a.status ?? "Thinking…"));
  for (const action of a.actions) {
    list.append(
      el(
        "div",
        { class: "action-card" },
        el("strong", {}, action.title),
        action.detail ? el("span", {}, action.detail) : null,
        el("a", { href: `${state.auth.baseUrl}/queue`, target: "_blank", rel: "noopener" }, "Review in Queue ↗"),
      ),
    );
  }
  queueMicrotask(() => {
    list.scrollTop = list.scrollHeight;
  });

  const input = el("textarea", {
    id: "ask-input",
    rows: 1,
    oninput: (e) => {
      a.draft = e.target.value;
    },
    placeholder: state.meeting ? "Ask or tell Thread…" : "Start the transcript first",
    disabled: !state.meeting,
    onkeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const value = input.value;
        input.value = "";
        a.draft = "";
        ask(value);
      }
    },
  });
  const form = el(
    "div",
    { class: "ask-form" },
    input,
    el(
      "button",
      {
        class: `mic${ptt.active ? " recording" : ""}`,
        type: "button",
        disabled: !state.meeting || a.pending,
        title: ptt.active ? "Stop and send" : "Speak (Gnani)",
        onclick: () => togglePushToTalk(),
      },
      ptt.active ? "■" : "🎤",
    ),
    a.pending
      ? el("button", { class: "send", type: "button", onclick: () => a.abort?.abort(), title: "Stop" }, "■")
      : el(
          "button",
          {
            class: "send",
            type: "button",
            disabled: !state.meeting,
            title: "Send",
            onclick: () => {
              const value = input.value;
              input.value = "";
              a.draft = "";
              ask(value);
            },
          },
          "↑",
        ),
  );
  input.value = a.draft;
  return el("div", { class: "ask" }, list, form);
}

function renderCaptionsIfVisible() {
  if (state.panel === "captions") render();
  else renderLiveBits();
}

function renderAskIfVisible() {
  if (state.panel === "ask") render();
}

/** Cheap updates for the meters/timer so the whole panel doesn't re-render 4×/s. */
function renderLiveBits() {
  const capture = state.capture;
  if (!capture) return;
  const stat = document.getElementById("live-stat");
  const heard = capture.chunkers.reduce((max, c) => Math.max(max, c.stats.heardSec), 0);
  const sent = capture.chunkers.reduce((sum, c) => sum + c.stats.sentSec, 0);
  const elapsed = capture.baseOffsetSec + (Date.now() - capture.startedAt) / 1000;
  if (stat) {
    const skipped = heard > 5 ? `${Math.max(0, Math.round((1 - sent / heard) * 100))}% silence skipped · ` : "";
    stat.textContent = `${clock(elapsed)} · ${skipped}${capture.chunkers.reduce((n, c) => n + c.stats.chunks, 0)} clips${capture.inFlight ? ` · ${capture.inFlight} transcribing` : ""}`;
  }
  const meters = document.getElementById("meters");
  if (meters) {
    meters.replaceChildren(
      ...["meeting", "you"]
        .filter((k) => capture.sources[k])
        .map((k) =>
          el("span", { class: "meter", title: k === "you" ? "Your mic" : "Meeting audio" }, k === "you" ? "🎙" : "🔊", el("i", { style: `transform:scaleX(${Math.min(1, capture.levels[k] * 12)})` })),
        ),
    );
  }
}

function render() {
  const hadFocus = document.activeElement?.id === "ask-input";
  const view = !state.auth ? connectView() : state.meetCode || state.capture ? meetingView() : idleView();
  app.replaceChildren(...[noticeView(), view].filter(Boolean));
  if (hadFocus) {
    const input = document.getElementById("ask-input");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
  if (state.capture) renderLiveBits();
}

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  const stored = await chrome.storage.local.get(["language", "includeMic"]);
  if (stored.language) state.language = stored.language;
  if (typeof stored.includeMic === "boolean") state.includeMic = stored.includeMic;
  await loadAuth();
  state.meetCode = null; // force a reload for the current tab
  await refreshActiveTab();
}

chrome.tabs.onActivated.addListener(() => refreshActiveTab());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.tab?.id && (changeInfo.url || changeInfo.status === "complete")) refreshActiveTab();
});
chrome.windows.onFocusChanged.addListener(() => refreshActiveTab());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.auth) boot();
});
window.addEventListener("beforeunload", () => {
  if (state.capture) stopCapture();
});

boot();
