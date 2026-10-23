"use client";

import { useCallback, useRef, useState } from "react";

import { trpc } from "~/trpc/client";

export type StreamMessage = { role: "user" | "assistant"; content: string };

export type StreamActionCard = {
  kind: string;
  title: string;
  detail?: string;
  href?: string;
  lines?: string[];
  disposition?: "sent" | "queued";
  queueItemId?: string;
};

type ToolMemoryEntry = Record<string, unknown>;

/**
 * Minimal client for POST /agent/stream (SSE). Keeps its own short history so it can
 * run alongside the main Agent page — e.g. inside a meeting room with focusMeetingId.
 */
export function useAgentStream(opts: { meetingId?: string; userEmail?: string | null }) {
  const utils = trpc.useUtils();
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [actions, setActions] = useState<StreamActionCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const toolMemoryRef = useRef<ToolMemoryEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<StreamMessage[]>([]);

  const update = useCallback((next: (prev: StreamMessage[]) => StreamMessage[]) => {
    setMessages((prev) => {
      const value = next(prev);
      messagesRef.current = value;
      return value;
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setStatus(null);
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || abortRef.current) return;
      const history = messagesRef.current.slice(-10);
      update((prev) => [...prev, { role: "user", content: message }]);
      setPending(true);
      setStatus(null);
      setError(null);
      setActions([]);

      const controller = new AbortController();
      abortRef.current = controller;

      const appendToken = (text: string) =>
        update((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") return [...prev.slice(0, -1), { role: "assistant", content: last.content + text }];
          return [...prev, { role: "assistant", content: text }];
        });

      try {
        const res = await fetch("/agent/stream", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "x-thread-csrf": "1" },
          body: JSON.stringify({
            message,
            history,
            toolMemory: toolMemoryRef.current,
            userEmail: opts.userEmail ?? undefined,
            focusCleared: true,
            focusMeetingId: opts.meetingId,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Agent request failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let event = "";
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
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(line.slice(6)) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (event === "status") setStatus(String(data.label ?? "Working…"));
            else if (event === "token") appendToken(String(data.text ?? ""));
            else if (event === "complete") {
              const reply = String(data.reply ?? "");
              update((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") return [...prev.slice(0, -1), { role: "assistant", content: reply }];
                return [...prev, { role: "assistant", content: reply }];
              });
              setActions((data.actions as StreamActionCard[]) ?? []);
              toolMemoryRef.current = (data.toolMemory as ToolMemoryEntry[]) ?? toolMemoryRef.current;
              setStatus(null);
              void utils.queue.pendingCount.invalidate();
              void utils.queue.list.invalidate();
            } else if (event === "error") {
              throw new Error(String(data.message ?? "Agent error"));
            }
            event = "";
          }
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Agent request failed");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setPending(false);
        setStatus(null);
      }
    },
    [opts.meetingId, opts.userEmail, update, utils],
  );

  const reset = useCallback(() => {
    stop();
    update(() => []);
    setActions([]);
    toolMemoryRef.current = [];
  }, [stop, update]);

  return { messages, pending, status, actions, error, send, stop, reset };
}
