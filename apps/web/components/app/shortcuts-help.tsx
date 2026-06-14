"use client";

const SHORTCUTS = [
  { keys: "Ctrl+K", action: "Open command palette" },
  { keys: "?", action: "Show keyboard shortcuts" },
  { keys: "j / k", action: "Move selection (inbox)" },
  { keys: "Enter", action: "Open selected thread" },
  { keys: "/", action: "Focus inbox search" },
  { keys: "e", action: "Archive thread (inbox)" },
  { keys: "A / D", action: "Approve / dismiss first queue item" },
  { keys: "Esc", action: "Close pane or modal" },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="thread-cmdk-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="thread-cmdk" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={{ maxWidth: 420 }}>
        <div className="thread-cmdk-input" style={{ borderBottom: "1px solid var(--thread-line)" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Keyboard shortcuts</span>
          <span className="thread-app-kbd">?</span>
        </div>
        <div className="thread-cmdk-list" style={{ padding: "8px 0" }}>
          {SHORTCUTS.map((row) => (
            <div
              key={row.keys}
              className="thread-cmdk-item"
              style={{ cursor: "default", justifyContent: "space-between" }}
            >
              <span>{row.action}</span>
              <kbd className="thread-app-kbd">{row.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
