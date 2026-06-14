"use client";

import { useEffect, useRef, useState } from "react";

import { trpc } from "~/trpc/client";

/**
 * Subscribes to webhook-driven sync hints via SSE.
 * Invalidates inbox/calendar queries when Gmail or Calendar push notifications land.
 */
export function useSyncEvents() {
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  utilsRef.current = utils;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const es = new EventSource("/sync/events");

    es.addEventListener("ready", () => {
      setConnected(true);
    });

    es.addEventListener("sync", (message) => {
      try {
        const data = JSON.parse(message.data) as { type?: string };
        if (data.type === "inbox_updated") {
          void utilsRef.current.inbox.listThreads.invalidate();
          void utilsRef.current.inbox.listCachedThreads.invalidate();
        } else if (data.type === "calendar_updated") {
          void utilsRef.current.calendar.listEvents.invalidate();
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  return { connected };
}
