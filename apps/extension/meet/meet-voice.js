// Runs in Google Meet's own page (MAIN world). Off by default and inert until the user turns on
// "Speak in another language" in the Thread side panel. Then — and only then — the microphone
// track Meet is sending is swapped for one that carries the user's dubbed speech; turning it off
// swaps the real microphone back. Video is never touched.
(() => {
  if (window.__threadVoice) return;
  window.__threadVoice = true;

  const peers = new Set();
  const OriginalPeer = window.RTCPeerConnection;
  if (!OriginalPeer) return;

  // Remember every peer connection Meet opens, so the outgoing audio can be found later.
  function ThreadPeer(...args) {
    const pc = new OriginalPeer(...args);
    peers.add(pc);
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "closed") peers.delete(pc);
    });
    return pc;
  }
  ThreadPeer.prototype = OriginalPeer.prototype;
  Object.setPrototypeOf(ThreadPeer, OriginalPeer);
  window.RTCPeerConnection = ThreadPeer;

  let armed = null; // { ctx, dest, swaps: [{ sender, original }], cursor, timer }

  function post(message) {
    window.postMessage({ __threadFromPage: "voice", ...message }, window.location.origin);
  }

  function audioSenders() {
    const out = [];
    for (const pc of peers) {
      if (pc.connectionState === "closed") continue;
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === "audio") out.push(sender);
      }
    }
    return out;
  }

  async function arm() {
    if (armed) return post({ type: "state", armed: true, senders: armed.swaps.length });
    const senders = audioSenders();
    if (!senders.length) return post({ type: "state", armed: false, error: "Join the call (with your mic) first." });
    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    const dest = ctx.createMediaStreamDestination();
    const dubTrack = dest.stream.getAudioTracks()[0];
    const swaps = [];
    for (const sender of senders) {
      const original = sender.track;
      try {
        await sender.replaceTrack(dubTrack);
        swaps.push({ sender, original });
      } catch {
        /* this sender can't be swapped; leave it alone */
      }
    }
    // Respect Meet's mute: while the real mic is muted, nothing dubbed is sent either.
    const timer = setInterval(() => {
      const live = swaps.some((s) => s.original && s.original.enabled && s.original.readyState === "live");
      dubTrack.enabled = live;
    }, 200);
    armed = { ctx, dest, swaps, cursor: 0, timer };
    post({ type: "state", armed: true, senders: swaps.length });
  }

  async function disarm() {
    if (!armed) return post({ type: "state", armed: false });
    const { ctx, swaps, timer } = armed;
    armed = null;
    clearInterval(timer);
    for (const { sender, original } of swaps) {
      try {
        // Only restore if Meet hasn't switched devices on its own meanwhile.
        if (sender.track && sender.track.kind === "audio" && original.readyState === "live") await sender.replaceTrack(original);
      } catch {
        /* sender already closed */
      }
    }
    await ctx.close().catch(() => {});
    post({ type: "state", armed: false });
  }

  async function play(base64, gainDb) {
    if (!armed) return;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const buffer = await armed.ctx.decodeAudioData(bytes.buffer).catch(() => null);
    if (!buffer || !armed) return;
    const source = armed.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = armed.ctx.createGain();
    gain.gain.value = Math.pow(10, Math.max(-6, Math.min(6, Number(gainDb) || 0)) / 20);
    source.connect(gain).connect(armed.dest);
    // Utterances play back-to-back, never on top of each other.
    const at = Math.max(armed.ctx.currentTime + 0.02, armed.cursor);
    source.start(at);
    armed.cursor = at + buffer.duration + 0.08;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.__threadToPage !== "voice") return;
    if (data.action === "arm") void arm();
    else if (data.action === "disarm") void disarm();
    else if (data.action === "play" && typeof data.audio === "string") void play(data.audio, data.gainDb);
    else if (data.action === "status") post({ type: "state", armed: Boolean(armed), senders: armed ? armed.swaps.length : 0 });
  });
})();
