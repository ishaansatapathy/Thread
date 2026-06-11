"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Inbox,
  Calendar,
  Bot,
  Settings,
  Search,
  LogOut,
  ChevronsUpDown,
  PanelsTopLeft,
  ListChecks,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import { ThreadWordmark } from "~/components/thread/thread-logo";
import { ThreadCommand } from "./thread-command";
import { ThreadGmailConnect, ThreadGmailConnectMenuItem } from "./thread-gmail-connect";
import { ThreadCalendarConnect } from "./thread-calendar-connect";
import { useThreadUser, initials } from "./use-thread-user";

const NAV = [
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Queue", href: "/queue", icon: ListChecks },
  { label: "Calendar", href: "/calendar", icon: Calendar },
  { label: "Agent", href: "/agent", icon: Bot },
];

const PAGE_META: Record<string, { title: string; sub: string }> = {
  "/inbox": { title: "Inbox", sub: "Triage what matters" },
  "/queue": { title: "Queue", sub: "Approve before anything sends" },
  "/calendar": { title: "Calendar", sub: "Schedule without switching tabs" },
  "/agent": { title: "Agent", sub: "Corsair MCP commands" },
  "/settings": { title: "Settings", sub: "Account & connections" },
};

export function ThreadAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, isError } = useThreadUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const queueCountQuery = trpc.queue.pendingCount.useQuery({});
  const queueCount = queueCountQuery.data?.count ?? 0;

  const logout = trpc.auth.logout.useMutation({
    onSettled: async () => {
      await utils.auth.me.reset();
      window.location.assign("/");
    },
  });

  useEffect(() => {
    if (!isLoading && isError) {
      const next = encodeURIComponent(pathname || "/inbox");
      router.replace(`/sign-in?next=${next}`);
    }
  }, [isLoading, isError, pathname, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (isLoading || isError || !user) {
    return (
      <div className="thread-page thread-app-splash">
        <div className="thread-app-spinner" aria-label="Loading" />
      </div>
    );
  }

  const meta = PAGE_META[pathname ?? "/inbox"] ?? { title: "Thread", sub: "" };

  return (
    <div className="thread-page thread-app">
      <aside className="thread-app-side">
        <Link href="/inbox" className="thread-app-side-head">
          <Image src="/thread-logo.svg" alt="Thread" width={24} height={24} priority />
          <ThreadWordmark size="sm" />
        </Link>

        <nav className="thread-app-nav">
          <span className="thread-app-nav-label">Workspace</span>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className="thread-app-nav-item" data-active={active}>
                <item.icon size={16} />
                {item.label}
                {item.href === "/inbox" && queueCount > 0 && (
                  <span className="thread-app-nav-count">{queueCount}</span>
                )}
                {item.href === "/queue" && queueCount > 0 && (
                  <span className="thread-app-nav-count">{queueCount}</span>
                )}
                {item.href === "/agent" && <span className="thread-app-nav-pill">MCP</span>}
              </Link>
            );
          })}

          <span className="thread-app-nav-label">Account</span>
          <Link href="/settings" className="thread-app-nav-item" data-active={pathname === "/settings"}>
            <Settings size={16} />
            Settings
          </Link>
          <Link href="/" className="thread-app-nav-item">
            <PanelsTopLeft size={16} />
            Landing page
          </Link>
        </nav>

        <div className="thread-app-user" ref={menuRef}>
          {menuOpen && (
            <div className="thread-app-menu">
              <Link href="/settings" className="thread-app-menu-item" onClick={() => setMenuOpen(false)}>
                <Settings size={14} />
                Settings
              </Link>
              <ThreadGmailConnectMenuItem onNavigate={() => setMenuOpen(false)} />
              <div className="thread-app-menu-sep" />
              <button
                type="button"
                className="thread-app-menu-item"
                data-danger="true"
                onClick={() => logout.mutate({})}
                disabled={logout.isPending}
              >
                <LogOut size={14} />
                {logout.isPending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}

          <button type="button" className="thread-app-user-btn" onClick={() => setMenuOpen((v) => !v)}>
            <span className="thread-app-avatar">
              {user.profileImageUrl ? (
                <img src={user.profileImageUrl} alt="" />
              ) : (
                initials(user.displayName ?? user.fullName, user.email)
              )}
            </span>
            <span className="thread-app-user-meta">
              <span className="thread-app-user-name">{user.displayName || user.fullName || "Thread user"}</span>
            </span>
            <ChevronsUpDown size={15} style={{ color: "var(--thread-dim)", flexShrink: 0 }} />
          </button>
        </div>
      </aside>

      <div className="thread-app-main">
        <header className="thread-app-topbar">
          <span className="thread-app-title">
            {meta.title}
            {meta.sub && <span className="thread-app-title-sub">{meta.sub}</span>}
          </span>

          <button type="button" className="thread-app-search" onClick={() => setCmdOpen(true)}>
            <Search size={14} />
            <span>Search commands…</span>
            <span className="thread-app-search-kbd">
              <kbd className="thread-app-kbd">⌘</kbd>
              <kbd className="thread-app-kbd">K</kbd>
            </span>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <ThreadCalendarConnect />
            <ThreadGmailConnect />
          </div>
        </header>

        <main className="thread-app-content">{children}</main>
      </div>

      <ThreadCommand open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
