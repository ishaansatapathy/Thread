"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Inbox,
  Calendar,
  Settings,
  PenLine,
  Send,
  Mail,
  ListChecks,
  CornerDownLeft,
  Bot,
  BarChart2,
  Keyboard,
  Sun,
} from "lucide-react";

type CommandAction = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: typeof Inbox;
  run: () => void;
};

export function ThreadCommand({
  open,
  onClose,
  onShowShortcuts,
}: {
  open: boolean;
  onClose: () => void;
  onShowShortcuts?: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo<CommandAction[]>(() => {
    const go = (path: string) => () => {
      router.push(path);
      onClose();
    };
    return [
      { id: "brief", group: "Navigate", label: "Open daily brief", icon: Sun, run: go("/brief") },
      { id: "inbox", group: "Navigate", label: "Go to Inbox", icon: Inbox, run: go("/inbox") },
      { id: "search", group: "Navigate", label: "Search inbox", hint: "Press /", icon: Search, run: go("/inbox?focus=search") },
      { id: "queue", group: "Navigate", label: "Open approval queue", icon: ListChecks, run: go("/queue") },
      { id: "calendar", group: "Navigate", label: "Go to Calendar", icon: Calendar, run: go("/calendar") },
      { id: "agent", group: "Navigate", label: "Open Thread Agent", icon: Bot, run: go("/agent") },
      { id: "analytics", group: "Navigate", label: "Go to Analytics", icon: BarChart2, run: go("/analytics") },
      { id: "settings", group: "Navigate", label: "Go to Settings", icon: Settings, run: go("/settings") },
      { id: "compose", group: "Actions", label: "Compose new email", icon: PenLine, run: go("/inbox?compose=1") },
      { id: "compose-reply", group: "Actions", label: "Open inbox to reply", hint: "Inbox", icon: PenLine, run: go("/inbox") },
      { id: "approve", group: "Actions", label: "Review approval queue", icon: ListChecks, run: go("/queue") },
      { id: "invite", group: "Actions", label: "Send calendar invite", hint: "Calendar", icon: Send, run: go("/calendar") },
      { id: "connect", group: "Actions", label: "Connect Gmail", icon: Mail, run: go("/settings") },
      { id: "kbd-cmd", group: "Shortcuts", label: "Open command palette", hint: "Ctrl+K", icon: Search, run: onClose },
      { id: "kbd-search", group: "Shortcuts", label: "Focus inbox search", hint: "/", icon: Search, run: go("/inbox?focus=search") },
      { id: "kbd-queue", group: "Shortcuts", label: "Go to approval queue", hint: "From anywhere", icon: ListChecks, run: go("/queue") },
      { id: "kbd-help", group: "Shortcuts", label: "Keyboard shortcuts", hint: "?", icon: Keyboard, run: () => { onClose(); onShowShortcuts?.(); } },
    ];
  }, [router, onClose, onShowShortcuts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      document.body.style.overflow = "hidden";
      return () => {
        window.clearTimeout(id);
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  let lastGroup = "";

  return (
    <div className="thread-cmdk-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="thread-cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="thread-cmdk-input">
          <Search size={16} style={{ opacity: 0.5 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search commands…"
            aria-label="Search commands"
          />
          <span className="thread-app-kbd">esc</span>
        </div>

        <div className="thread-cmdk-list">
          {filtered.length === 0 ? (
            <div className="thread-cmdk-empty">No commands found</div>
          ) : (
            filtered.map((a, i) => {
              const showGroup = a.group !== lastGroup;
              lastGroup = a.group;
              return (
                <div key={a.id}>
                  {showGroup && <div className="thread-cmdk-group">{a.group}</div>}
                  <button
                    type="button"
                    className="thread-cmdk-item"
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={a.run}
                  >
                    <a.icon size={15} />
                    <span>{a.label}</span>
                    {a.hint && <span className="thread-cmdk-item-hint">{a.hint}</span>}
                    {i === active && !a.hint && (
                      <CornerDownLeft size={13} className="thread-cmdk-item-hint" style={{ marginLeft: "auto" }} />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
