"use client";

import { MessageSquarePlus, MessagesSquare, Trash2 } from "lucide-react";

import { trpc } from "~/trpc/client";
import type { RouterOutputs } from "@repo/trpc/client";

type SessionListItem = RouterOutputs["agent"]["listSessions"][number];

type AgentSessionSidebarProps = {
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  disabled?: boolean;
};

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function sessionTitle(session: SessionListItem): string {
  if (session.title?.trim()) return session.title.trim();
  if (session.focusThreadLabel?.trim()) return session.focusThreadLabel.trim();
  if (session.focusEventLabel?.trim()) return session.focusEventLabel.trim();
  return "New chat";
}

export function AgentSessionSidebar({
  activeSessionId,
  onSelectSession,
  onNewChat,
  disabled,
}: AgentSessionSidebarProps) {
  const utils = trpc.useUtils();
  const sessionsQuery = trpc.agent.listSessions.useQuery({ limit: 30 }, { staleTime: 10_000 });
  const deleteSession = trpc.agent.deleteSession.useMutation({
    onSuccess: async () => {
      await utils.agent.listSessions.invalidate();
    },
  });

  const sessions = sessionsQuery.data ?? [];

  return (
    <aside className="thread-agent-sidebar" aria-label="Agent conversations">
      <div className="thread-agent-sidebar-head">
        <MessagesSquare size={14} />
        Chats
        <button
          type="button"
          className="thread-agent-sidebar-new"
          onClick={onNewChat}
          disabled={disabled}
          title="New chat"
        >
          <MessageSquarePlus size={14} />
          New
        </button>
      </div>

      <div className="thread-agent-sidebar-list">
        {sessionsQuery.isLoading ? (
          <p className="thread-agent-sidebar-empty">Loading chats…</p>
        ) : sessions.length === 0 ? (
          <p className="thread-agent-sidebar-empty">No chats yet — start a new conversation.</p>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className="thread-agent-sidebar-item-wrap"
                data-active={active ? "true" : undefined}
              >
                <button
                  type="button"
                  className="thread-agent-sidebar-item"
                  onClick={() => onSelectSession(session.id)}
                  disabled={disabled}
                >
                  <span className="thread-agent-sidebar-item-title">{sessionTitle(session)}</span>
                  <span className="thread-agent-sidebar-item-meta">
                    {session.messageCount > 0 ? `${session.messageCount} msgs · ` : ""}
                    {formatRelativeTime(new Date(session.updatedAt))}
                  </span>
                </button>
                <button
                  type="button"
                  className="thread-agent-sidebar-delete"
                  onClick={() => deleteSession.mutate({ id: session.id })}
                  disabled={disabled || deleteSession.isPending}
                  aria-label="Delete chat"
                  title="Delete chat"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
