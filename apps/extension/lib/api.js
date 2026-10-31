// Talks to the Thread web app (which proxies to the API) with the extension's bearer token.
// No cookies are ever sent: credentials: "omit".

export class AuthError extends Error {}

export async function getAuth() {
  const { auth } = await chrome.storage.local.get("auth");
  return auth?.token && auth?.baseUrl ? auth : null;
}

export async function clearAuth() {
  await chrome.storage.local.remove("auth");
}

async function request(path, init = {}) {
  const auth = await getAuth();
  if (!auth) throw new AuthError("Not connected");
  const res = await fetch(`${auth.baseUrl}${path}`, {
    ...init,
    credentials: "omit",
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${auth.token}` },
  });
  if (res.status === 401) {
    await clearAuth();
    throw new AuthError("Your Thread connection expired — connect again.");
  }
  return res;
}

async function json(path, init) {
  const res = await request(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  me: () => json("/api-extension/me"),

  speechStatus: () => json("/api-speech/status"),

  meetingsForCall: (meetUrl) => json(`/api-meetings?meetUrl=${encodeURIComponent(meetUrl)}`).then((d) => d.meetings ?? []),

  recentMeetings: () => json("/api-meetings").then((d) => d.meetings ?? []),

  getMeeting: (id) => json(`/api-meetings/${id}`),

  createMeeting: (body) =>
    json("/api-meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),

  endMeeting: (id) => json(`/api-meetings/${id}/end`, { method: "POST" }),

  refreshNotes: (id) => json(`/api-meetings/${id}/refresh-notes`, { method: "POST" }),

  async uploadChunk(id, chunk, speaker, language, keepAudio = false) {
    const res = await request(`/api-meetings/${id}/chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav",
        "X-Start-Seconds": chunk.startSec.toFixed(2),
        "X-Duration-Seconds": chunk.durationSec.toFixed(2),
        "X-Speaker": speaker,
        "X-Language": language,
        ...(keepAudio ? { "X-Keep-Audio": "1" } : {}),
      },
      body: chunk.wav,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error ?? "Transcription failed");
      error.status = res.status;
      throw error;
    }
    return data.segment ?? null;
  },

  voiceStatus: () => json("/api-meetings/voice"),

  dubOptions: () => json("/api-meetings/dub/options"),

  /**
   * Live dubbing for one utterance. direction "speak" = my words into the call in My voice;
   * "listen" = other people's words, translated for me. Resolves null when nothing was said.
   */
  async dubLive(id, wav, { direction, language, target }) {
    const res = await request(`/api-meetings/${id}/dub/live`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav", "X-Direction": direction, "X-Language": language, "X-Target": target },
      body: wav,
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const error = new Error(data.error ?? "Live dubbing failed");
      error.status = res.status;
      throw error;
    }
    const decode = (name) => {
      try {
        return decodeURIComponent(res.headers.get(name) ?? "");
      } catch {
        return "";
      }
    };
    return {
      audio: await res.arrayBuffer(),
      translation: decode("X-Translation"),
      gainDb: Number(res.headers.get("X-Gain-Db") ?? 0) || 0,
    };
  },

  async transcribe(wav, language) {
    const data = await json("/api-speech/transcribe", {
      method: "POST",
      headers: { "Content-Type": "audio/wav", "X-Language": language },
      body: wav,
    });
    return data.text ?? "";
  },

  /**
   * Streams one agent turn, scoped to a meeting (meetingId) or to text picked on a web page
   * (pageContext, from Captain Thread). Calls onToken / onStatus as SSE events arrive and
   * resolves with { reply, actions, toolMemory }.
   */
  async agent({ message, history, toolMemory, meetingId, pageContext, email }, { onToken, onStatus, signal }) {
    const res = await request("/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history,
        toolMemory,
        focusCleared: true,
        focusMeetingId: meetingId,
        pageContext,
        userEmail: email ?? undefined,
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Agent request failed");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event = "";
    let result = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          event = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith("data: ")) continue;
        let data;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (event === "status") onStatus?.(String(data.label ?? "Working…"));
        else if (event === "token") onToken?.(String(data.text ?? ""));
        else if (event === "complete") result = { reply: String(data.reply ?? ""), actions: data.actions ?? [], toolMemory: data.toolMemory ?? toolMemory };
        else if (event === "error") throw new Error(String(data.message ?? "Agent error"));
        event = "";
      }
    }
    return result ?? { reply: "", actions: [], toolMemory };
  },
};
