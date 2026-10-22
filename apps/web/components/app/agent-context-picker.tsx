"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Folder,
  HardDrive,
  Loader2,
  Mail,
  Paperclip,
  Presentation,
  Search,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import type { AgentFocusState } from "./agent-focus-chip";

export type AttachedFile = { name: string; url: string; app: FileTab };

type AgentContextPickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (focus: AgentFocusState) => void;
  onSelectFile: (file: AttachedFile) => void;
  disabled?: boolean;
};

type FileTab = "drive" | "docs" | "sheets" | "forms" | "slides";
type PickerTab = "inbox" | "calendar" | FileTab;

const FILE_TABS: Array<{ tab: FileTab; label: string; icon: typeof HardDrive }> = [
  { tab: "drive", label: "Drive", icon: HardDrive },
  { tab: "docs", label: "Docs", icon: FileText },
  { tab: "sheets", label: "Sheets", icon: FileSpreadsheet },
  { tab: "forms", label: "Forms", icon: ClipboardList },
  { tab: "slides", label: "Slides", icon: Presentation },
];
const FILE_TAB_KEYS = new Set<PickerTab>(FILE_TABS.map((f) => f.tab));

function fileTabIcon(tab: FileTab, isFolder: boolean) {
  if (isFolder) return Folder;
  return FILE_TABS.find((f) => f.tab === tab)?.icon ?? HardDrive;
}

function calendarPickerBounds() {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 7);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 30);
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: 12,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function AgentContextPicker({ open, onClose, onSelect, onSelectFile, disabled }: AgentContextPickerProps) {
  const [tab, setTab] = useState<PickerTab>("inbox");
  const [query, setQuery] = useState("");
  const isFileTab = FILE_TAB_KEYS.has(tab);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setTab("inbox");
    }
  }, [open]);

  const inboxQuery = trpc.inbox.listThreads.useQuery(
    { maxResults: 12, query: query.trim() || undefined },
    { enabled: open && tab === "inbox", staleTime: 30_000 },
  );

  const calendarQuery = trpc.calendar.listEvents.useQuery(
    { ...calendarPickerBounds(), q: query.trim() || undefined },
    { enabled: open && tab === "calendar", staleTime: 30_000 },
  );

  const filesQuery = trpc.workspace.listFiles.useQuery(
    { app: isFileTab ? (tab as FileTab) : "drive", query: query.trim() || undefined },
    { enabled: open && isFileTab, staleTime: 30_000 },
  );

  const threads = useMemo(() => inboxQuery.data?.threads ?? [], [inboxQuery.data]);
  const events = useMemo(() => calendarQuery.data?.events ?? [], [calendarQuery.data]);
  const files = useMemo(() => filesQuery.data?.files.filter((f) => !f.isFolder) ?? [], [filesQuery.data]);
  const loading = tab === "inbox" ? inboxQuery.isLoading : tab === "calendar" ? calendarQuery.isLoading : filesQuery.isLoading;

  if (!open) return null;

  return (
    <div className="thread-agent-context-picker" role="dialog" aria-label="Attach context">
      <div className="thread-agent-context-picker-head">
        <Paperclip size={14} />
        <span>Attach context</span>
        <button type="button" className="thread-agent-context-picker-close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="thread-agent-context-picker-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inbox"}
          data-active={tab === "inbox" ? "true" : undefined}
          onClick={() => setTab("inbox")}
        >
          <Mail size={13} />
          Inbox
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "calendar"}
          data-active={tab === "calendar" ? "true" : undefined}
          onClick={() => setTab("calendar")}
        >
          <Calendar size={13} />
          Calendar
        </button>
        {FILE_TABS.map(({ tab: fileTab, label, icon: Icon }) => (
          <button
            key={fileTab}
            type="button"
            role="tab"
            aria-selected={tab === fileTab}
            data-active={tab === fileTab ? "true" : undefined}
            onClick={() => setTab(fileTab)}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="thread-agent-context-picker-search">
        <Search size={13} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "inbox" ? "Search threads…" : tab === "calendar" ? "Search events…" : "Search by name…"}
          disabled={disabled}
        />
      </div>

      <ul className="thread-agent-context-picker-list" role="listbox">
        {loading ? (
          <li className="thread-agent-context-picker-empty">
            <Loader2 size={14} className="thread-spin" />
            Loading…
          </li>
        ) : tab === "inbox" ? (
          threads.length === 0 ? (
            <li className="thread-agent-context-picker-empty">No threads found</li>
          ) : (
            threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className="thread-agent-context-picker-item"
                  disabled={disabled}
                  onClick={() => {
                    onSelect({
                      threadId: thread.id,
                      threadLabel: thread.subject?.trim() || thread.fromName || thread.from || "Email thread",
                      eventId: undefined,
                      eventLabel: undefined,
                    });
                    onClose();
                  }}
                >
                  <Mail size={13} />
                  <span className="thread-agent-context-picker-item-main">
                    <strong>{thread.subject?.trim() || "(no subject)"}</strong>
                    <span>{thread.fromName || thread.from || "Unknown sender"}</span>
                  </span>
                </button>
              </li>
            ))
          )
        ) : tab === "calendar" ? (
          events.length === 0 ? (
            <li className="thread-agent-context-picker-empty">No events found</li>
          ) : (
            events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  className="thread-agent-context-picker-item"
                  disabled={disabled}
                  onClick={() => {
                    onSelect({
                      eventId: event.id,
                      eventLabel: event.summary?.trim() || "Calendar event",
                      threadId: undefined,
                      threadLabel: undefined,
                    });
                    onClose();
                  }}
                >
                  <Calendar size={13} />
                  <span className="thread-agent-context-picker-item-main">
                    <strong>{event.summary?.trim() || "(no title)"}</strong>
                    <span>{event.start ? new Date(event.start).toLocaleString() : "No start time"}</span>
                  </span>
                </button>
              </li>
            ))
          )
        ) : filesQuery.isError ? (
          <li className="thread-agent-context-picker-empty">
            {filesQuery.error.message}{" "}
            <Link href="/settings" onClick={onClose}>
              Open Settings
            </Link>
          </li>
        ) : files.length === 0 ? (
          <li className="thread-agent-context-picker-empty">No files found</li>
        ) : (
          files.map((file) => {
            const Icon = fileTabIcon(tab as FileTab, false);
            return (
              <li key={file.id}>
                <button
                  type="button"
                  className="thread-agent-context-picker-item"
                  disabled={disabled}
                  onClick={() => {
                    onSelectFile({ name: file.name, url: file.url, app: tab as FileTab });
                    onClose();
                  }}
                >
                  <Icon size={13} />
                  <span className="thread-agent-context-picker-item-main">
                    <strong>{file.name}</strong>
                    <span>{file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : ""}</span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
