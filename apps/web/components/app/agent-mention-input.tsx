"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, SendHorizonal, UserRound } from "lucide-react";

import { trpc } from "~/trpc/client";
import type { RouterOutputs } from "@repo/trpc/client";

type Contact = RouterOutputs["contacts"]["search"]["contacts"][number];

const SYNC_STORAGE_KEY = "thread:contacts-full-sync-at";
const SYNC_TTL_MS = 24 * 60 * 60 * 1000;

function getActiveMention(text: string, cursor: number) {
  const before = text.slice(0, cursor);
  const match = before.match(/(?:^|\s)@([\w.-]*)$/);
  if (!match) return null;
  const query = match[1] ?? "";
  const start = before.length - query.length - 1;
  return { start, query };
}

type AgentMentionInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
};

export function AgentMentionInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: AgentMentionInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [syncPhase, setSyncPhase] = useState<"idle" | "syncing" | "done">("idle");
  const [syncProgress, setSyncProgress] = useState<{
    scanned: number;
    imported: number;
    estimate?: number;
  } | null>(null);

  const utils = trpc.useUtils();
  const syncQuick = trpc.contacts.syncFromInbox.useMutation();
  const syncBatch = trpc.contacts.syncInboxBatch.useMutation();

  useEffect(() => {
    let cancelled = false;

    async function runFullContactSync() {
      const last = localStorage.getItem(SYNC_STORAGE_KEY);
      if (last && Date.now() - Number(last) < SYNC_TTL_MS) {
        try {
          await syncQuick.mutateAsync({});
          void utils.contacts.search.invalidate();
        } catch {
          /* best-effort refresh */
        }
        setSyncPhase("done");
        return;
      }

      setSyncPhase("syncing");
      setSyncProgress({ scanned: 0, imported: 0 });

      try {
        const quick = await syncQuick.mutateAsync({});
        setSyncProgress({ scanned: 0, imported: quick.imported });

        let pageToken: string | undefined;
        let totalScanned = 0;
        let totalImported = quick.imported;
        let estimate: number | undefined;

        do {
          if (cancelled) return;
          const batch = await syncBatch.mutateAsync({ pageToken, pageSize: 25 });
          totalScanned += batch.threadsScanned;
          totalImported += batch.imported;
          estimate = batch.resultSizeEstimate ?? estimate;
          pageToken = batch.nextPageToken;
          setSyncProgress({ scanned: totalScanned, imported: totalImported, estimate });
          if (batch.done || !pageToken) break;
        } while (pageToken);

        localStorage.setItem(SYNC_STORAGE_KEY, String(Date.now()));
        void utils.contacts.search.invalidate();
      } catch {
        /* partial sync still usable */
      } finally {
        if (!cancelled) {
          setSyncPhase("done");
          setSyncProgress(null);
        }
      }
    }

    void runFullContactSync();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(mention?.query ?? ""), 120);
    return () => window.clearTimeout(id);
  }, [mention?.query]);

  const search = trpc.contacts.search.useQuery(
    { query: debouncedQuery, limit: 8 },
    { enabled: Boolean(mention && debouncedQuery.length >= 1), staleTime: 30_000 },
  );

  const suggestions = search.data?.contacts ?? [];
  const showSuggestions = Boolean(mention && debouncedQuery.length >= 1);

  const updateMention = useCallback((text: string, pos: number) => {
    setCursor(pos);
    setMention(getActiveMention(text, pos));
    setActiveIndex(0);
  }, []);

  const pickContact = (contact: Contact) => {
    if (!mention || !inputRef.current) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(cursor);
    const insert = contact.email;
    const spacer = after.startsWith(" ") || after.length === 0 ? "" : " ";
    const next = `${before}${insert}${spacer}${after}`;
    const nextCursor = before.length + insert.length + spacer.length;
    onChange(next);
    setMention(null);
    setActiveIndex(0);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const picked = suggestions[activeIndex];
        if (picked) pickContact(picked);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="thread-agent-composer-wrap">
      {syncPhase === "syncing" && syncProgress ? (
        <div className="thread-agent-sync-banner">
          <Loader2 size={12} className="thread-spin" />
          Importing senders from all inbox mail…
          <span className="thread-agent-sync-banner-meta">
            {syncProgress.scanned} threads scanned · {syncProgress.imported} contacts
            {syncProgress.estimate ? ` · ~${syncProgress.estimate} in inbox` : ""}
          </span>
        </div>
      ) : null}

      {showSuggestions ? (
        <ul className="thread-agent-mentions" role="listbox" aria-label="Contact suggestions">
          {syncPhase === "syncing" || (search.isFetching && suggestions.length === 0) ? (
            <li className="thread-agent-mentions-empty">
              <Loader2 size={12} className="thread-spin" /> Loading senders…
            </li>
          ) : suggestions.length === 0 ? (
            <li className="thread-agent-mentions-empty">
              No matches yet — wait for inbox import to finish or open Inbox first.
            </li>
          ) : null}
          {suggestions.map((contact, i) => (
            <li key={contact.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                data-active={i === activeIndex ? "true" : undefined}
                className="thread-agent-mentions-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickContact(contact)}
              >
                <UserRound size={14} />
                <span className="thread-agent-mentions-main">
                  <strong>{contact.displayName || contact.handle}</strong>
                  <span>{contact.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="thread-agent-composer">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onClick={(e) => updateMention(value, e.currentTarget.selectionStart ?? value.length)}
          onKeyUp={(e) => updateMention(value, e.currentTarget.selectionStart ?? value.length)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Agent message"
          autoComplete="off"
        />
        <button
          type="button"
          className="thread-agent-send"
          disabled={disabled || !value.trim()}
          aria-label="Send"
          onClick={onSubmit}
        >
          <SendHorizonal size={16} />
        </button>
      </div>
    </div>
  );
}
