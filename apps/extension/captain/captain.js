// Captain Thread — the in-page assistant. Runs on every site (top frame only):
//   • a sleeping Captain docked at the edge of the page (click for options, drag to move)
//   • a small bar next to any text selection: Ask Captain · Explain · Hint · Copy
//   • "draw around anything" (Alt+Shift+C): circle a part of the page, Captain reads the text inside
//   • an answer card that streams the reply right there — no tab switching
// All UI lives in a closed shadow root so the page's CSS can't touch it (and ours can't leak).
// API calls go through the service worker; this script never sees the auth token.

(() => {
  if (window.top !== window || globalThis.__threadCaptain) return;
  const Art = globalThis.ThreadCaptainArt;
  if (!Art) return;
  globalThis.__threadCaptain = true;

  const MAX_TEXT = 6000;
  const AREA_SHORTCUT = "Alt+Shift+C";

  const QUICK = {
    explain: { label: "Explain", prompt: "Explain this to me." },
    hint: { label: "Hint", prompt: "Give me a hint — just the next step, don't reveal the full solution." },
    simplify: { label: "Simplify", prompt: "Explain this in simple words, like I'm new to it." },
    bug: { label: "Find the bug", prompt: "What's wrong here, and how do I fix it?" },
    summarize: { label: "Summarize", prompt: "Summarize this in a few bullet points." },
    nextHint: { label: "Next hint", prompt: "Give me the next hint — still not the full solution." },
    solution: { label: "Show full solution", prompt: "Okay, show me the full solution and explain it step by step." },
    deeper: { label: "Go deeper", prompt: "Go deeper on that." },
    example: { label: "Give an example", prompt: "Give me a concrete example." },
    simpler: { label: "Explain simpler", prompt: "Explain that more simply." },
  };

  const ICONS = {
    send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/>',
    page: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    eyeOff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.2 3.2M6.6 6.6A18 18 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    sleep: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  };
  const icon = (name, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const S = {
    settings: { dock: true, selection: true, offSites: [], dockY: 0.74, greeted: true },
    connected: false,
    host: null,
    root: null,
    layer: null,
    dock: null,
    menu: null,
    bar: null,
    panel: null,
    area: null,
    mark: null,
    toast: null,
    convo: null,
    hover: false,
    happyUntil: 0,
    pointer: null,
  };

  // ── plumbing ──────────────────────────────────────────────────────────────────
  function alive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function send(type, extra = {}) {
    return new Promise((resolve) => {
      if (!alive()) return resolve(null);
      try {
        chrome.runtime.sendMessage({ type, ...extra }, (response) => {
          void chrome.runtime.lastError;
          resolve(response ?? null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  // Some Google sites enforce Trusted Types; fall back to a pass-through policy. Every string
  // set here is either our own static markup or markdown that was HTML-escaped first.
  let htmlPolicy = null;
  function setHTML(node, html) {
    try {
      node.innerHTML = html;
      return;
    } catch {}
    try {
      htmlPolicy ??= globalThis.trustedTypes.createPolicy("thread-captain", { createHTML: (s) => s });
      node.innerHTML = htmlPolicy.createHTML(html);
    } catch {
      node.textContent = "";
    }
  }

  function h(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.text != null) node.textContent = props.text;
    if (props.html != null) setHTML(node, props.html);
    for (const [key, value] of Object.entries(props.attrs ?? {})) {
      if (value != null && value !== false) node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const [event, fn] of Object.entries(props.on ?? {})) node.addEventListener(event, fn);
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const siteOff = () => S.settings.offSites.includes(location.hostname);
  const inOurUi = (event) => Boolean(S.host) && event.composedPath().includes(S.host);
  const words = (text) => (text.trim().match(/\S+/g) ?? []).length;

  function ensureHost() {
    if (S.host?.isConnected) return;
    if (!S.host) {
      S.host = document.createElement("thread-captain");
      S.host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
      S.root = S.host.attachShadow({ mode: "closed" });
      const css = Art.css + UI_CSS;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        S.root.adoptedStyleSheets = [sheet];
      } catch {
        S.root.append(h("style", { text: css }));
      }
      S.layer = h("div", { class: "tc-layer" });
      // Keep typing inside Captain from triggering the site's own keyboard shortcuts.
      for (const type of ["keydown", "keyup", "keypress"]) {
        S.layer.addEventListener(type, (e) => {
          if (e.key === "Escape" && type === "keydown") return;
          e.stopPropagation();
        });
      }
      S.root.append(S.layer);
    }
    // A Captain left behind by an older copy of the extension (before an update) goes away.
    for (const stale of document.querySelectorAll("thread-captain")) if (stale !== S.host) stale.remove();
    document.documentElement.append(S.host);
  }

  function teardown() {
    S.host?.remove();
    for (const [type, fn, opts] of LISTENERS) window.removeEventListener(type, fn, opts);
    document.removeEventListener("fullscreenchange", renderDock);
  }

  // ── mood: one Captain, one feeling at a time ─────────────────────────────────
  function mood() {
    if (S.convo?.busy) return "working";
    if (Date.now() < S.happyUntil) return "happy";
    if (S.hover || S.menu || S.panel || S.area) return "awake";
    return "sleeping";
  }

  function refreshMood() {
    if (!S.root) return;
    const state = mood();
    for (const svg of S.root.querySelectorAll(".tc-follow .tc-captain")) {
      if (svg.dataset.state !== state) svg.dataset.state = state;
    }
  }

  // ── the dock ─────────────────────────────────────────────────────────────────
  function renderDock() {
    const show = S.settings.dock && !siteOff() && !document.fullscreenElement;
    if (!show) {
      S.dock?.remove();
      S.dock = null;
      closeMenu();
      return;
    }
    if (S.dock) return placeDock();
    ensureHost();

    const button = h("button", {
      class: "tc-dock-btn tc-follow",
      html: Art.svg({ state: mood(), size: 68 }),
      attrs: { type: "button", "aria-label": "Captain Thread — open menu", "aria-haspopup": "menu" },
    });
    const tip = h("div", { class: "tc-tip", text: "Captain Thread · click me" });
    S.dock = h("div", { class: "tc-dock" }, [tip, button]);
    S.layer.append(S.dock);
    placeDock();

    button.addEventListener("pointerenter", () => {
      S.hover = true;
      refreshMood();
    });
    button.addEventListener("pointerleave", () => {
      S.hover = false;
      setTimeout(refreshMood, 900);
    });

    let drag = null;
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { startY: e.clientY, top: S.dock.offsetTop, moved: false };
      button.setPointerCapture(e.pointerId);
    });
    button.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dy) < 5) return;
      drag.moved = true;
      S.dock.classList.add("is-dragging");
      closeMenu();
      S.dock.style.top = `${clamp(drag.top + dy, 8, innerHeight - 84)}px`;
    });
    button.addEventListener("pointerup", () => {
      if (!drag) return;
      const { moved } = drag;
      drag = null;
      S.dock.classList.remove("is-dragging");
      if (moved) {
        S.settings.dockY = (S.dock.offsetTop + 34) / innerHeight;
        send("captain:set", { dockY: S.settings.dockY });
      } else {
        toggleMenu();
      }
    });
    button.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleMenu();
      }
    });

    if (!S.settings.greeted) greet();
  }

  function placeDock() {
    if (!S.dock) return;
    S.dock.style.top = `${clamp(S.settings.dockY * innerHeight - 34, 8, innerHeight - 84)}px`;
  }

  function greet() {
    S.settings.greeted = true;
    send("captain:set", { greeted: true });
    S.happyUntil = Date.now() + 2600;
    refreshMood();
    setTimeout(refreshMood, 2700);
    const bubble = h("div", { class: "tc-greet" }, [
      h("strong", { text: "Hi, I'm Captain Thread!" }),
      h("span", { text: "Select any text, or press " }),
      h("kbd", { text: AREA_SHORTCUT }),
      h("span", { text: " and draw around anything — I'll help right here." }),
    ]);
    S.dock.append(bubble);
    setTimeout(() => bubble.classList.add("is-leaving"), 7000);
    setTimeout(() => bubble.remove(), 7400);
  }

  function toggleMenu() {
    if (S.menu) return closeMenu();
    S.dock.querySelector(".tc-greet")?.remove();
    const item = (iconName, label, onClick, hint) =>
      h("button", { class: "tc-menu-item", attrs: { type: "button", role: "menuitem" }, on: { click: () => (closeMenu(), onClick()) } }, [
        h("span", { class: "tc-menu-icon", html: icon(iconName) }),
        h("span", { class: "tc-menu-label", text: label }),
        hint ? h("kbd", { text: hint }) : null,
      ]);
    S.menu = h("div", { class: `tc-menu tc-card ${S.settings.dockY > 0.5 ? "is-up" : "is-down"}`, attrs: { role: "menu" } }, [
      h("div", { class: "tc-menu-head", text: S.connected ? "What should we look at?" : "Captain Thread" }),
      item("scan", "Draw around something", startArea, AREA_SHORTCUT),
      item("page", "Ask about this page", () => openPanel({ text: visibleText(), source: "page" })),
      item("chat", "Ask anything", () => openPanel({ text: "", source: "page" })),
      h("div", { class: "tc-menu-sep" }),
      item("eyeOff", `Turn off on ${location.hostname.replace(/^www\./, "")}`, () => {
        send("captain:set", { siteOff: true });
        showToast("Captain is off on this site. Turn it back on from the Thread side panel.");
      }),
      item("sleep", "Hide the floating Captain", () => {
        send("captain:set", { dock: false });
        showToast("Hidden. Selecting text still brings me back.");
      }),
    ]);
    S.dock.classList.add("is-menu-open");
    S.dock.append(S.menu);
    S.menu.querySelector("button")?.focus();
    refreshMood();
  }

  function closeMenu() {
    if (!S.menu) return;
    S.menu.remove();
    S.menu = null;
    S.dock?.classList.remove("is-menu-open");
    refreshMood();
  }

  // ── text selection → the Captain bar ─────────────────────────────────────────
  function deepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function currentSelection() {
    const active = deepActiveElement();
    const isField =
      active &&
      (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && /^(text|search|url|email|)$/i.test(active.getAttribute("type") ?? "")));
    if (isField) {
      const { selectionStart: start, selectionEnd: end } = active;
      if (start == null || end <= start) return null;
      return { text: active.value.slice(start, end), rect: null };
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { text: selection.toString(), rect: rect.width || rect.height ? rect : null };
  }

  function anchorRect(rect) {
    if (rect) return rect;
    const p = S.pointer ?? { x: innerWidth / 2, y: innerHeight / 2 };
    return { left: p.x, right: p.x, top: p.y - 8, bottom: p.y + 8, width: 0, height: 16 };
  }

  const looksLikeCode = (text) =>
    (text.match(/[{};]|=>|\b(def|function|return|class|const|let|var|public|static|void|int|import|#include)\b/g) ?? []).length >= 3;

  function checkSelection() {
    if (!alive()) return teardown();
    if (S.area) return;
    const picked = currentSelection();
    const text = picked?.text.trim() ?? "";
    if (!S.settings.selection || siteOff() || text.length < 2) return hideBar();
    showBar(picked.text, anchorRect(picked.rect));
  }

  function showBar(text, rect) {
    ensureHost();
    hideBar();
    const code = looksLikeCode(text);
    const second = code ? QUICK.bug : QUICK.hint;
    const page = { text, source: "selection" };
    const quick = (q, kind) =>
      h("button", { class: "tc-bar-btn", text: q.label, attrs: { type: "button" }, on: { click: () => openPanel(page, { anchor: rect, question: q.prompt, kind }) } });

    const copyBtn = h("button", {
      class: "tc-bar-btn tc-bar-icon",
      html: icon("copy", 14),
      attrs: { type: "button", title: "Copy", "aria-label": "Copy" },
      on: {
        click: async () => {
          await copyText(text);
          setHTML(copyBtn, icon("check", 14));
          setTimeout(hideBar, 600);
        },
      },
    });

    S.bar = h(
      "div",
      { class: "tc-bar tc-card", attrs: { role: "toolbar", "aria-label": "Captain Thread" } },
      [
        h(
          "button",
          { class: "tc-bar-ask", attrs: { type: "button" }, on: { click: () => openPanel(page, { anchor: rect }) } },
          [h("span", { class: "tc-bar-face", html: Art.svg({ state: "awake", size: 26 }) }), h("span", { text: "Ask Captain" })],
        ),
        h("span", { class: "tc-bar-sep" }),
        quick(QUICK.explain, "explain"),
        quick(second, code ? "bug" : "hint"),
        copyBtn,
      ],
    );
    // Clicking the bar must not clear the page's selection.
    S.bar.addEventListener("mousedown", (e) => e.preventDefault());
    S.layer.append(S.bar);

    const { width, height } = S.bar.getBoundingClientRect();
    const x = clamp(rect.left + rect.width / 2 - width / 2, 8, innerWidth - width - 8);
    const above = rect.top - height - 10;
    const y = above >= 8 ? above : Math.min(rect.bottom + 10, innerHeight - height - 8);
    S.bar.style.left = `${x}px`;
    S.bar.style.top = `${y}px`;
  }

  function hideBar() {
    S.bar?.remove();
    S.bar = null;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand("copy");
    }
  }

  // ── draw around anything (no screenshot — reads the text inside the shape) ───
  function startArea() {
    if (S.area) return;
    hideBar();
    closeMenu();
    ensureHost();

    const canvas = h("canvas", { class: "tc-area-canvas" });
    const hint = h("div", { class: "tc-area-hint tc-card" }, [
      h("span", { class: "tc-follow", html: Art.svg({ state: "awake", size: 30 }) }),
      h("span", { text: "Draw around anything you want to ask about — or click a paragraph" }),
      h("kbd", { text: "Esc" }),
    ]);
    const overlay = h("div", { class: "tc-area", attrs: { "aria-label": "Draw around the part of the page to ask about" } }, [canvas, hint]);
    S.area = overlay;
    S.layer.append(overlay);
    refreshMood();

    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    let points = null;

    const draw = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (!points || points.length < 2) return;
      const gradient = ctx.createLinearGradient(0, 0, innerWidth, innerHeight);
      gradient.addColorStop(0, "#38bdf8");
      gradient.addColorStop(0.55, "#3b82f6");
      gradient.addColorStop(1, "#fb7185");
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.fillStyle = "rgba(59,130,246,0.10)";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = gradient;
      ctx.shadowColor = "rgba(59,130,246,0.75)";
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    overlay.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      points = [{ x: e.clientX, y: e.clientY }];
      overlay.setPointerCapture(e.pointerId);
      hint.classList.add("is-faded");
    });
    overlay.addEventListener("pointermove", (e) => {
      if (!points) return;
      points.push({ x: e.clientX, y: e.clientY });
      draw();
    });
    overlay.addEventListener("pointerup", (e) => {
      if (!points) return;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      points = null;
      const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
      endArea();
      if (box.right - box.left < 12 && box.bottom - box.top < 12) pickBlockAt(e.clientX, e.clientY);
      else askAboutArea(box);
    });
  }

  function endArea() {
    S.area?.remove();
    S.area = null;
    refreshMood();
  }

  function askAboutArea(box) {
    const rect = { ...box, width: box.right - box.left, height: box.bottom - box.top };
    const text = textInRect(rect);
    if (!text.trim()) {
      showToast("I couldn't find readable text there — images and canvases can't be read yet.");
      return;
    }
    showMark(rect);
    openPanel({ text, source: "area" }, { anchor: rect });
  }

  // A click instead of a shape: take the paragraph (or code block) under the pointer.
  function pickBlockAt(x, y) {
    let node = document.elementFromPoint(x, y);
    while (node && node !== document.body && (node.innerText ?? "").trim().length < 40) node = node.parentElement;
    const text = (node?.innerText ?? "").trim();
    if (!node || node === document.body || !text || text.length > MAX_TEXT * 2) {
      showToast("Draw a circle around what you want — that spot was too big or empty.");
      return;
    }
    const r = node.getBoundingClientRect();
    const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    showMark(rect);
    openPanel({ text, source: "area" }, { anchor: rect });
  }

  /** Visible text inside a viewport rectangle, in reading order, one line per block. */
  function textInRect(rect, limit = MAX_TEXT) {
    const intersects = (b) => b.right > rect.left && b.left < rect.right && b.bottom > rect.top && b.top < rect.bottom;
    const contains = (b) => b.left >= rect.left - 2 && b.right <= rect.right + 2 && b.top >= rect.top - 2 && b.bottom <= rect.bottom + 2;
    const centreInside = (b) => {
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
    };
    const blocks = new Map();
    const blockOf = (el) => {
      if (blocks.has(el)) return blocks.get(el);
      let node = el;
      while (node && node !== document.body) {
        const display = getComputedStyle(node).display;
        if (!display.startsWith("inline") && display !== "contents") break;
        node = node.parentElement;
      }
      blocks.set(el, node ?? document.body);
      return node ?? document.body;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest("script,style,noscript,template,svg title")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const range = document.createRange();
    const pieces = [];
    let total = 0;

    for (let node = walker.nextNode(); node && total < limit; node = walker.nextNode()) {
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (!box.width || !box.height || !intersects(box)) continue;
      const style = getComputedStyle(node.parentElement);
      if (style.visibility === "hidden" || style.opacity === "0") continue;

      let text;
      if (contains(box)) {
        text = node.nodeValue;
      } else {
        // Partly inside: keep only the words whose centre falls in the shape.
        const kept = [];
        for (const match of node.nodeValue.matchAll(/\S+/g)) {
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          if (centreInside(range.getBoundingClientRect())) kept.push(match[0]);
        }
        text = kept.join(" ");
      }
      text = text.replace(/ /g, " ");
      if (!text.trim()) continue;
      pieces.push({ block: blockOf(node.parentElement), text, top: box.top });
      total += text.length;
    }

    // Code editors like Monaco reuse line elements, so DOM order isn't line order there.
    for (let i = 0; i < pieces.length; ) {
      if (!pieces[i].block.classList?.contains("view-line")) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < pieces.length && pieces[j].block.classList?.contains("view-line")) j += 1;
      const run = pieces.slice(i, j).sort((a, b) => a.top - b.top);
      pieces.splice(i, j - i, ...run);
      i = j;
    }

    let out = "";
    let lastBlock = null;
    for (const piece of pieces) {
      if (lastBlock && piece.block !== lastBlock) out = `${out.trimEnd()}\n`;
      out += piece.text;
      lastBlock = piece.block;
    }
    return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
  }

  function visibleText() {
    const text = textInRect({ left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight });
    if (text.length >= 200) return text;
    return (document.body?.innerText ?? "").trim().slice(0, MAX_TEXT);
  }

  function showMark(rect) {
    clearMark();
    S.mark = h("div", { class: "tc-mark" });
    Object.assign(S.mark.style, {
      left: `${rect.left - 6}px`,
      top: `${rect.top - 6}px`,
      width: `${rect.width + 12}px`,
      height: `${rect.height + 12}px`,
    });
    S.layer.append(S.mark);
  }

  function clearMark() {
    S.mark?.remove();
    S.mark = null;
  }

  // ── the answer card ──────────────────────────────────────────────────────────
  function openPanel(page, { anchor = null, question = null, kind = null } = {}) {
    hideBar();
    closeMenu();
    closePanel({ keepMark: true });
    ensureHost();

    const text = (page.text ?? "").trim();
    S.convo = {
      page: { text: text.slice(0, MAX_TEXT), source: page.source },
      truncated: text.length > MAX_TEXT,
      messages: [],
      toolMemory: [],
      actions: [],
      port: null,
      busy: false,
      status: "",
      error: null,
      lastKind: null,
    };

    const input = h("textarea", {
      class: "tc-input",
      attrs: { rows: 1, placeholder: text ? "Ask about this…" : "Ask Thread anything…", "aria-label": "Your question" },
      on: {
        input: () => autosize(input),
        keydown: (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            submit();
          }
        },
      },
    });
    const sendBtn = h("button", { class: "tc-send", attrs: { type: "submit", "aria-label": "Send" }, html: icon("send", 16) });
    const form = h("form", { class: "tc-compose", on: { submit: (e) => (e.preventDefault(), submit()) } }, [input, sendBtn]);
    const submit = () => {
      if (S.convo?.busy) return stopAnswer();
      const q = input.value.trim();
      if (!q) return;
      input.value = "";
      autosize(input);
      ask(q, "custom");
    };

    const head = h("header", { class: "tc-head" }, [
      h("div", { class: "tc-head-art tc-follow", html: Art.svg({ state: "awake", size: 46 }) }),
      h("div", { class: "tc-head-text" }, [h("strong", { text: "Captain Thread" }), h("span", { class: "tc-status", text: "Ready when you are" })]),
      h("button", {
        class: "tc-icon-btn",
        html: icon("external", 15),
        attrs: { type: "button", title: "Continue in Thread", "aria-label": "Continue in Thread" },
        on: { click: continueInThread },
      }),
      h("button", {
        class: "tc-icon-btn",
        html: icon("close", 16),
        attrs: { type: "button", title: "Close (Esc)", "aria-label": "Close" },
        on: { click: () => closePanel() },
      }),
    ]);

    const context = text
      ? h(
          "button",
          {
            class: "tc-context",
            attrs: { type: "button", title: "Show all" },
            on: { click: () => context.classList.toggle("is-open") },
          },
          [
            h("span", {
              class: "tc-context-label",
              text: `${{ selection: "Your selection", area: "What you circled", page: "This page" }[page.source]} · ${words(text)} words${S.convo.truncated ? " (first part)" : ""}`,
            }),
            h("span", { class: "tc-quote", text: text.slice(0, 2000) }),
          ],
        )
      : null;

    S.panel = h("div", { class: "tc-panel tc-card", attrs: { role: "dialog", "aria-label": "Captain Thread" } }, [
      head,
      context,
      h("div", { class: "tc-body", attrs: { "aria-live": "polite" } }),
      h("div", { class: "tc-chips" }),
      form,
      h("div", { class: "tc-foot", text: "What you pick is sent to Thread to answer · Esc to close" }),
    ]);
    S.layer.append(S.panel);
    placePanel(anchor);
    makeDraggable(head);
    renderPanel();
    refreshMood();

    send("captain:init").then((res) => {
      if (!res?.ok || !S.convo) return;
      S.connected = res.connected;
      if (!S.connected) return renderPanel();
      if (question) ask(question, kind);
      else input.focus();
    });
  }

  function placePanel(anchor) {
    const panel = S.panel;
    const width = Math.min(400, innerWidth - 24);
    panel.style.width = `${width}px`;
    const fallback = () => {
      panel.style.right = `${S.dock ? 92 : 16}px`;
      panel.style.bottom = "16px";
      panel.style.maxHeight = `${Math.min(600, innerHeight - 32)}px`;
    };
    if (!anchor) return fallback();

    const left = clamp(anchor.left, 12, innerWidth - width - 12);
    const below = innerHeight - anchor.bottom - 22;
    const above = anchor.top - 22;
    if (below >= 340) {
      panel.style.left = `${left}px`;
      panel.style.top = `${anchor.bottom + 12}px`;
      panel.style.maxHeight = `${Math.min(600, below)}px`;
    } else if (above >= 340) {
      panel.style.left = `${left}px`;
      panel.style.bottom = `${innerHeight - anchor.top + 12}px`;
      panel.style.maxHeight = `${Math.min(600, above)}px`;
    } else {
      fallback();
    }
  }

  function makeDraggable(handle) {
    let drag = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const r = S.panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
      Object.assign(S.panel.style, { left: `${r.left}px`, top: `${r.top}px`, right: "auto", bottom: "auto" });
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = S.panel.getBoundingClientRect();
      S.panel.style.left = `${clamp(e.clientX - drag.dx, 4, innerWidth - r.width - 4)}px`;
      S.panel.style.top = `${clamp(e.clientY - drag.dy, 4, innerHeight - 60)}px`;
    });
    handle.addEventListener("pointerup", () => {
      drag = null;
    });
  }

  function autosize(input) {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function chipsFor(c) {
    if (c.busy) return [];
    if (!c.messages.length) {
      if (!c.page.text) return [];
      if (looksLikeCode(c.page.text)) return [["explain", QUICK.explain], ["bug", QUICK.bug], ["hint", QUICK.hint]];
      if (c.page.text.length > 600) return [["summarize", QUICK.summarize], ["explain", QUICK.explain], ["simplify", QUICK.simplify]];
      return [["explain", QUICK.explain], ["simplify", QUICK.simplify], ["hint", QUICK.hint]];
    }
    if (c.error) return [];
    if (c.lastKind === "hint" || c.lastKind === "nextHint") return [["nextHint", QUICK.nextHint], ["solution", QUICK.solution]];
    return [["deeper", QUICK.deeper], ["example", QUICK.example], ["simpler", QUICK.simpler]];
  }

  function renderPanel() {
    const c = S.convo;
    const panel = S.panel;
    if (!c || !panel) return;
    const body = panel.querySelector(".tc-body");
    const chips = panel.querySelector(".tc-chips");
    const input = panel.querySelector(".tc-input");
    const sendBtn = panel.querySelector(".tc-send");
    body.textContent = "";
    chips.textContent = "";

    if (!S.connected) {
      body.append(
        h("div", { class: "tc-connect" }, [
          h("div", { html: Art.svg({ state: "sleeping", size: 84 }) }),
          h("strong", { text: "Wake me up by connecting Thread" }),
          h("p", { text: "Captain answers with your Thread account. Connect once and I'll work on every site." }),
          h("button", {
            class: "tc-primary",
            text: "Connect Thread",
            attrs: { type: "button" },
            on: {
              click: () => {
                send("captain:connect");
                setStatus("Waiting for you to connect…");
              },
            },
          }),
        ]),
      );
      input.disabled = true;
      sendBtn.disabled = true;
      setStatus("Not connected yet");
      return;
    }
    input.disabled = false;
    sendBtn.disabled = false;

    if (!c.messages.length && !c.error) {
      body.append(
        h("p", {
          class: "tc-empty",
          text: c.page.text ? "Pick a quick action or ask your own question." : "Ask about your mail, calendar, Drive — or anything at all.",
        }),
      );
    }

    for (const m of c.messages) {
      if (m.role === "user") {
        body.append(h("div", { class: "tc-msg-user", text: m.content }));
        continue;
      }
      const answer = h("div", { class: "tc-msg-ai" });
      if (m.html) setHTML(answer, m.html);
      if (m.pending && !m.html) answer.append(h("span", { class: "tc-typing" }, [h("i"), h("i"), h("i")]));
      m.el = answer;
      body.append(answer);
      if (!m.pending && m.content) {
        const copy = h("button", {
          class: "tc-mini",
          attrs: { type: "button" },
          html: `${icon("copy", 12)}<span>Copy</span>`,
          on: {
            click: async () => {
              await copyText(m.content);
              setHTML(copy, `${icon("check", 12)}<span>Copied</span>`);
            },
          },
        });
        body.append(h("div", { class: "tc-msg-tools" }, [copy]));
      }
    }

    for (const action of c.actions) {
      body.append(
        h("div", { class: "tc-action" }, [
          h("strong", { text: action.title }),
          action.detail ? h("span", { text: action.detail }) : null,
          h("button", {
            class: "tc-link",
            text: "Review in Queue ↗",
            attrs: { type: "button" },
            on: { click: () => send("captain:open", { page: "queue" }) },
          }),
        ]),
      );
    }

    if (c.error) {
      body.append(
        h("div", { class: "tc-error" }, [
          h("span", { text: c.error.message }),
          c.error.needsConnect
            ? h("button", { class: "tc-link", text: "Connect Thread", attrs: { type: "button" }, on: { click: () => send("captain:connect") } })
            : null,
        ]),
      );
    }

    for (const [kind, q] of chipsFor(c)) {
      chips.append(h("button", { class: "tc-chip", text: q.label, attrs: { type: "button" }, on: { click: () => ask(q.prompt, kind) } }));
    }

    setHTML(sendBtn, icon(c.busy ? "stop" : "send", 16));
    sendBtn.setAttribute("aria-label", c.busy ? "Stop" : "Send");
    sendBtn.classList.toggle("is-stop", c.busy);
    setStatus(c.status || (c.messages.length ? "Anything else?" : "Ready when you are"));
    body.scrollTop = body.scrollHeight;
  }

  function setStatus(text) {
    const status = S.panel?.querySelector(".tc-status");
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-busy", Boolean(S.convo?.busy));
  }

  function ask(question, kind) {
    const c = S.convo;
    if (!c || c.busy || !question.trim()) return;
    if (!S.connected) return renderPanel();

    const history = c.messages.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }));
    const answer = { role: "assistant", content: "", html: "", pending: true };
    c.messages.push({ role: "user", content: question }, answer);
    c.busy = true;
    c.error = null;
    c.actions = [];
    c.lastKind = kind;
    c.status = "Reading it…";
    renderPanel();
    refreshMood();

    let port;
    try {
      port = chrome.runtime.connect({ name: "captain" });
    } catch {
      return failAnswer(c, answer, { message: "Thread was just updated — refresh this page to keep using Captain." });
    }
    c.port = port;

    port.onMessage.addListener((msg) => {
      if (S.convo !== c || !c.busy) return;
      if (msg.type === "status") {
        c.status = msg.label;
        setStatus(c.status);
      } else if (msg.type === "delta") {
        answer.html = msg.html;
        if (c.status !== "Writing…") setStatus((c.status = "Writing…"));
        if (answer.el) {
          const body = answer.el.parentElement;
          const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
          setHTML(answer.el, answer.html);
          if (nearBottom) body.scrollTop = body.scrollHeight;
        }
      } else if (msg.type === "done") {
        answer.content = msg.text;
        answer.html = msg.html;
        answer.pending = false;
        c.toolMemory = msg.toolMemory ?? [];
        c.actions = msg.actions ?? [];
        finishAnswer(c, true);
      } else if (msg.type === "error") {
        if (msg.needsConnect) S.connected = false;
        failAnswer(c, answer, msg);
      }
    });
    port.onDisconnect.addListener(() => {
      if (S.convo === c && c.busy) failAnswer(c, answer, { message: "Lost the connection to Thread — try again." });
    });
    port.postMessage({ type: "ask", question, history, toolMemory: c.toolMemory, page: c.page.text ? c.page : null });
  }

  function finishAnswer(c, ok) {
    c.busy = false;
    try {
      c.port?.disconnect();
    } catch {}
    c.port = null;
    c.status = ok ? "Here you go ✦" : "That didn't work";
    if (ok) {
      S.happyUntil = Date.now() + 2600;
      setTimeout(refreshMood, 2700);
    }
    renderPanel();
    refreshMood();
    if (ok) S.panel?.querySelector(".tc-input")?.focus();
  }

  function failAnswer(c, answer, { message, needsConnect = false }) {
    if (!answer.html) c.messages = c.messages.filter((m) => m !== answer);
    answer.pending = false;
    c.error = { message: message || "Captain couldn't answer that — try again.", needsConnect };
    finishAnswer(c, false);
  }

  function stopAnswer() {
    const c = S.convo;
    if (!c?.busy) return;
    const answer = c.messages.at(-1);
    if (answer?.role === "assistant") {
      answer.pending = false;
      if (!answer.html) c.messages.pop();
    }
    finishAnswer(c, false);
    c.status = "Stopped";
    setStatus(c.status);
  }

  function continueInThread() {
    const c = S.convo;
    if (!c) return;
    const lastQuestion = [...c.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const snippet = c.page.text.slice(0, 1200);
    const prompt = snippet
      ? `About this from "${document.title || location.hostname}" (${location.href}):\n"""\n${snippet}\n"""\n${lastQuestion}`
      : lastQuestion;
    send("captain:open", { prompt });
  }

  function closePanel({ keepMark = false } = {}) {
    const c = S.convo;
    if (c?.port) {
      try {
        c.port.disconnect();
      } catch {}
    }
    S.convo = null;
    S.panel?.remove();
    S.panel = null;
    if (!keepMark) clearMark();
    refreshMood();
  }

  function showToast(text) {
    ensureHost();
    S.toast?.remove();
    S.toast = h("div", { class: "tc-toast tc-card" }, [h("span", { html: Art.svg({ state: "awake", size: 28 }) }), h("span", { text })]);
    S.layer.append(S.toast);
    const toast = S.toast;
    setTimeout(() => toast.classList.add("is-leaving"), 3600);
    setTimeout(() => toast.remove(), 4000);
  }

  // ── page listeners ───────────────────────────────────────────────────────────
  const LISTENERS = [
    [
      "mouseup",
      (e) => {
        if (inOurUi(e)) return;
        S.pointer = { x: e.clientX, y: e.clientY };
        setTimeout(checkSelection, 10);
      },
      true,
    ],
    [
      "keyup",
      (e) => {
        if (inOurUi(e)) return;
        if (e.shiftKey || e.key === "Shift" || ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "a")) setTimeout(checkSelection, 10);
      },
      true,
    ],
    [
      "mousedown",
      (e) => {
        if (inOurUi(e)) return;
        hideBar();
        closeMenu();
      },
      true,
    ],
    [
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        if (S.area) return endArea();
        if (S.menu) return closeMenu();
        if (S.bar) return hideBar();
        if (S.panel && (inOurUi(e) || !deepActiveElement()?.isContentEditable)) closePanel();
      },
      true,
    ],
    [
      "scroll",
      (e) => {
        if (inOurUi(e)) return;
        hideBar();
        clearMark();
      },
      { capture: true, passive: true },
    ],
    [
      "resize",
      () => {
        placeDock();
        if (S.area) endArea();
      },
      { passive: true },
    ],
    [
      "visibilitychange",
      () => {
        if (document.visibilityState !== "visible" || !alive()) return;
        send("captain:init").then((res) => {
          if (!res?.ok) return;
          const wasConnected = S.connected;
          S.connected = res.connected;
          S.settings = res.settings;
          renderDock();
          if (S.panel && wasConnected !== S.connected) renderPanel();
        });
      },
      false,
    ],
  ];
  for (const [type, fn, opts] of LISTENERS) window.addEventListener(type, fn, opts);
  document.addEventListener("fullscreenchange", renderDock);
  document.addEventListener("selectionchange", () => {
    if (S.bar && !currentSelection()) hideBar();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "captain:ping") {
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "captain:settings") {
      S.settings = msg.settings;
      renderDock();
      if (siteOff()) hideBar();
    } else if (msg?.type === "captain:area") {
      startArea();
    } else if (msg?.type === "captain:ask") {
      const picked = currentSelection();
      const text = picked?.text.trim() ? picked.text : String(msg.text ?? "");
      if (text.trim()) openPanel({ text, source: "selection" }, { anchor: picked?.rect ?? null });
    }
  });

  send("captain:init").then((res) => {
    if (!res?.ok) return;
    S.settings = res.settings;
    S.connected = res.connected;
    renderDock();
  });

  // ── styles (inside the shadow root only) ─────────────────────────────────────
  const UI_CSS = `
.tc-layer {
  position: fixed; inset: 0; pointer-events: none;
  font: 13.5px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #f4f6fb; -webkit-font-smoothing: antialiased; text-align: left; letter-spacing: normal;
  --tc-blue: #3b82f6; --tc-blue-2: #2563eb; --tc-sky: #38bdf8; --tc-coral: #fb7185;
  --tc-line: rgba(255,255,255,.1); --tc-muted: rgba(255,255,255,.62); --tc-dim: rgba(255,255,255,.42);
}
.tc-layer *, .tc-layer *::before, .tc-layer *::after { box-sizing: border-box; }
.tc-layer > * { pointer-events: auto; }
.tc-layer button { font: inherit; color: inherit; }
.tc-layer kbd {
  font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 3px 6px; border-radius: 6px;
  background: rgba(255,255,255,.08); border: 1px solid var(--tc-line); color: var(--tc-muted); white-space: nowrap;
}
.tc-card {
  background: rgba(11,11,14,.97); border: 1px solid var(--tc-line); border-radius: 16px;
  box-shadow: 0 24px 60px -16px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.25);
  backdrop-filter: blur(18px) saturate(1.2);
}

/* dock */
.tc-dock { position: fixed; right: 12px; width: 68px; height: 68px; }
.tc-dock-btn {
  all: unset; display: block; width: 68px; height: 68px; cursor: grab; touch-action: none;
  filter: drop-shadow(0 8px 14px rgba(15,23,42,.3)); transition: transform .2s cubic-bezier(.3,1.4,.6,1);
}
.tc-dock-btn:hover { transform: translateY(-3px) scale(1.05); }
.tc-dock-btn:focus-visible { outline: 2px solid var(--tc-sky); outline-offset: 2px; border-radius: 50%; }
.tc-dock.is-dragging .tc-dock-btn { cursor: grabbing; transform: scale(1.1); }
.tc-tip {
  position: absolute; right: 76px; top: 50%; transform: translate(6px, -50%); opacity: 0; pointer-events: none;
  white-space: nowrap; padding: 6px 10px; border-radius: 10px; font-size: 12px; font-weight: 600;
  background: #0b0b0e; border: 1px solid var(--tc-line); box-shadow: 0 8px 24px rgba(0,0,0,.35); transition: .18s ease;
}
.tc-dock:hover .tc-tip { opacity: 1; transform: translate(0, -50%); }
.tc-dock.is-menu-open .tc-tip, .tc-dock.is-dragging .tc-tip { opacity: 0; }
.tc-greet {
  position: absolute; right: 78px; bottom: 30px; width: 236px; padding: 12px 14px; border-radius: 14px 14px 4px 14px;
  background: linear-gradient(135deg, #1d4ed8, #3b82f6); color: #fff; font-size: 12.5px; line-height: 1.5;
  box-shadow: 0 16px 40px -10px rgba(37,99,235,.65); animation: tc-pop .35s cubic-bezier(.3,1.5,.6,1);
}
.tc-greet strong { display: block; font-size: 13.5px; margin-bottom: 2px; }
.tc-greet kbd { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.25); color: #fff; }
.tc-greet.is-leaving { opacity: 0; transform: translateY(4px); transition: .35s; }

.tc-menu { position: absolute; right: 76px; width: 312px; padding: 6px; animation: tc-pop .16s ease-out; }
.tc-menu.is-up { bottom: 0; }
.tc-menu.is-down { top: 0; }
.tc-menu-head { padding: 6px 10px 8px; font-size: 11.5px; font-weight: 600; color: var(--tc-dim); }
.tc-menu-item {
  all: unset; display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 10px;
  cursor: pointer; font-size: 13px; color: rgba(255,255,255,.88); box-sizing: border-box;
}
.tc-menu-item:hover, .tc-menu-item:focus-visible { background: rgba(255,255,255,.07); }
.tc-menu-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: rgba(59,130,246,.14); color: #93c5fd; flex: none; }
.tc-menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tc-menu-sep { height: 1px; margin: 6px 4px; background: var(--tc-line); }

/* selection bar */
.tc-bar { position: fixed; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 999px; animation: tc-pop .16s ease-out; }
.tc-bar-ask {
  all: unset; display: flex; align-items: center; gap: 6px; padding: 3px 12px 3px 3px; border-radius: 999px; cursor: pointer;
  background: linear-gradient(135deg, var(--tc-sky), var(--tc-blue) 55%, var(--tc-blue-2)); color: #fff;
  font-size: 12.5px; font-weight: 650; box-shadow: inset 0 1px 0 rgba(255,255,255,.25);
}
.tc-bar-ask:hover { filter: brightness(1.08); }
.tc-bar-face { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: rgba(255,255,255,.95); }
.tc-bar-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--tc-line); }
.tc-bar-btn {
  all: unset; padding: 6px 10px; border-radius: 999px; cursor: pointer; font-size: 12.5px; font-weight: 550; color: rgba(255,255,255,.86);
}
.tc-bar-btn:hover, .tc-bar-btn:focus-visible { background: rgba(255,255,255,.08); color: #fff; }
.tc-bar-icon { display: grid; place-items: center; padding: 6px 8px; }

/* draw-around */
.tc-area { position: fixed; inset: 0; cursor: crosshair; touch-action: none; background: rgba(2,6,23,.18); animation: tc-fade .15s ease-out; }
.tc-area-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.tc-area-hint {
  position: absolute; top: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  padding: 6px 8px 6px 6px; border-radius: 999px; font-size: 13px; font-weight: 550; white-space: nowrap;
  max-width: calc(100vw - 24px); pointer-events: none; transition: opacity .2s; animation: tc-pop .25s ease-out;
}
.tc-area-hint > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; }
.tc-area-hint.is-faded { opacity: .35; }
.tc-mark {
  position: fixed; border-radius: 12px; pointer-events: none; border: 2px solid rgba(96,165,250,.95);
  box-shadow: 0 0 0 4px rgba(59,130,246,.18), 0 0 28px rgba(59,130,246,.45); animation: tc-fade .2s ease-out;
}

/* answer card */
.tc-panel { position: fixed; display: flex; flex-direction: column; overflow: hidden; min-height: 220px; animation: tc-rise .22s cubic-bezier(.2,1.2,.4,1); }
.tc-head { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--tc-line); cursor: grab; user-select: none; touch-action: none; }
.tc-head-art { width: 46px; height: 46px; flex: none; margin: -4px 0; }
.tc-head-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tc-head-text strong { font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
.tc-status { font-size: 12px; color: var(--tc-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tc-status.is-busy {
  background: linear-gradient(90deg, rgba(255,255,255,.5), #fff, rgba(255,255,255,.5)); background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent; animation: tc-shimmer 1.4s linear infinite;
}
.tc-icon-btn { all: unset; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; cursor: pointer; color: var(--tc-muted); flex: none; }
.tc-icon-btn:hover, .tc-icon-btn:focus-visible { background: rgba(255,255,255,.08); color: #fff; }

.tc-context {
  all: unset; display: block; margin: 10px 12px 0; padding: 8px 10px; border-radius: 10px; cursor: pointer; box-sizing: border-box;
  background: rgba(59,130,246,.08); border: 1px solid rgba(96,165,250,.2);
}
.tc-context:hover { border-color: rgba(96,165,250,.38); }
.tc-context-label { display: block; font-size: 11px; font-weight: 650; color: #93c5fd; margin-bottom: 2px; }
.tc-quote {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 12.5px; color: rgba(255,255,255,.72); white-space: pre-wrap; word-break: break-word;
}
.tc-context.is-open .tc-quote { display: block; max-height: 180px; overflow-y: auto; }

.tc-body { flex: 1; min-height: 60px; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent; }
.tc-empty { margin: 0; color: var(--tc-dim); font-size: 12.5px; }
.tc-msg-user {
  align-self: flex-end; max-width: 86%; padding: 7px 11px; border-radius: 14px 14px 4px 14px;
  background: rgba(59,130,246,.2); border: 1px solid rgba(96,165,250,.22); white-space: pre-wrap; word-break: break-word;
}
.tc-msg-ai { color: #e7ebf3; line-height: 1.62; word-break: break-word; }
.tc-msg-ai p { margin: 0 0 8px; }
.tc-msg-ai p:last-child { margin-bottom: 0; }
.tc-msg-ai ul, .tc-msg-ai ol { margin: 0 0 8px; padding-left: 20px; }
.tc-msg-ai li { margin: 2px 0; }
.tc-msg-ai strong { color: #fff; }
.tc-msg-ai a { color: #93c5fd; text-decoration: underline; text-underline-offset: 2px; }
.tc-msg-ai code { font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 1px 5px; border-radius: 5px; background: rgba(255,255,255,.08); }
.tc-msg-ai pre {
  margin: 0 0 8px; padding: 10px 12px; border-radius: 10px; overflow-x: auto; background: #050507; border: 1px solid var(--tc-line);
  scrollbar-width: thin;
}
.tc-msg-ai pre code { padding: 0; background: none; white-space: pre; }
.tc-msg-tools { display: flex; gap: 6px; margin-top: -2px; }
.tc-mini { all: unset; display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 6px; cursor: pointer; font-size: 11.5px; color: var(--tc-dim); }
.tc-mini:hover { color: #fff; background: rgba(255,255,255,.06); }
.tc-typing { display: inline-flex; gap: 4px; padding: 6px 0; }
.tc-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--tc-blue); animation: tc-bounce 1s ease-in-out infinite; }
.tc-typing i:nth-child(2) { animation-delay: .15s; }
.tc-typing i:nth-child(3) { animation-delay: .3s; }
.tc-action { display: flex; flex-direction: column; gap: 2px; padding: 9px 11px; border-radius: 10px; background: rgba(110,231,183,.07); border: 1px solid rgba(110,231,183,.22); font-size: 12.5px; }
.tc-action span { color: var(--tc-muted); }
.tc-error { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 9px 11px; border-radius: 10px; background: rgba(248,113,113,.08); border: 1px solid rgba(248,113,113,.28); color: #fecaca; font-size: 12.5px; }
.tc-link { all: unset; cursor: pointer; color: #93c5fd; font-weight: 600; font-size: 12.5px; }
.tc-link:hover { text-decoration: underline; }

.tc-connect { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 6px 8px 10px; }
.tc-connect strong { font-size: 14px; }
.tc-connect p { margin: 0 0 6px; color: var(--tc-muted); font-size: 12.5px; }
.tc-primary {
  all: unset; padding: 8px 16px; border-radius: 10px; cursor: pointer; font-weight: 650; font-size: 13px; color: #fff;
  background: linear-gradient(135deg, var(--tc-sky), var(--tc-blue) 55%, var(--tc-blue-2)); box-shadow: 0 8px 20px -8px rgba(37,99,235,.8);
}
.tc-primary:hover { filter: brightness(1.08); }

.tc-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }
.tc-chips:empty { display: none; }
.tc-chip {
  all: unset; padding: 5px 11px; border-radius: 999px; cursor: pointer; font-size: 12px; font-weight: 550;
  border: 1px solid rgba(255,255,255,.14); color: rgba(255,255,255,.86); transition: .15s;
}
.tc-chip:hover, .tc-chip:focus-visible { border-color: var(--tc-blue); background: rgba(59,130,246,.12); color: #fff; }

.tc-compose {
  display: flex; align-items: flex-end; gap: 8px; margin: 0 10px 8px; padding: 6px 6px 6px 12px; border-radius: 14px;
  border: 1px solid rgba(255,255,255,.13); background: rgba(255,255,255,.03); transition: .15s;
}
.tc-compose:focus-within { border-color: var(--tc-blue); box-shadow: 0 0 0 3px rgba(59,130,246,.18); }
.tc-input {
  all: unset; flex: 1; min-height: 22px; max-height: 120px; padding: 4px 0; overflow-y: auto; white-space: pre-wrap;
  word-break: break-word; font-size: 13.5px; line-height: 1.45; color: #f4f6fb;
}
.tc-input::placeholder { color: var(--tc-dim); }
.tc-input:disabled { opacity: .5; }
.tc-send {
  all: unset; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; cursor: pointer; flex: none; color: #fff;
  background: linear-gradient(135deg, var(--tc-sky), var(--tc-blue) 55%, var(--tc-blue-2));
}
.tc-send.is-stop { background: rgba(255,255,255,.12); }
.tc-send:disabled { opacity: .4; cursor: default; }
.tc-foot { padding: 0 14px 10px; font-size: 11px; color: var(--tc-dim); }

.tc-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  padding: 6px 14px 6px 6px; border-radius: 999px; font-size: 13px; max-width: calc(100vw - 24px); animation: tc-rise .25s ease-out;
}
.tc-toast.is-leaving { opacity: 0; transition: opacity .35s; }

@keyframes tc-pop { from { opacity: 0; transform: translateY(4px) scale(.96); } }
@keyframes tc-rise { from { opacity: 0; transform: translateY(10px) scale(.98); } }
@keyframes tc-fade { from { opacity: 0; } }
@keyframes tc-bounce { 0%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-4px); opacity: 1; } }
@keyframes tc-shimmer { to { background-position: -200% 0; } }
.tc-toast > span:first-child, .tc-area-hint > span:first-child { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: rgba(255,255,255,.95); flex: none; }
@media (prefers-reduced-motion: reduce) {
  .tc-layer * { animation-duration: .01ms !important; transition: none !important; }
}
`;
})();
