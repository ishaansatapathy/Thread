"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  LayoutGrid,
  Settings,
  Search,
  LogOut,
  ChevronsUpDown,
  ListChecks,
  Bot,
  BarChart2,
  Menu,
  X,
  Sun,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import { ThreadWordmark } from "~/components/thread/thread-logo";
import { ThreadCommand } from "./thread-command";
import { ShortcutsHelp } from "./shortcuts-help";
import { ThreadGmailConnectMenuItem } from "./thread-gmail-connect";
import { ThreadWorkspaceConnect, useWorkspaceConnections, type AppKey } from "./thread-workspace-connect";
import { useThreadUser, initials } from "./use-thread-user";
import { useSyncEvents } from "~/hooks/use-sync-events";
import { ColumnResizer } from "./column-resizer";

const NAV_TOP = [
  { label: "Brief", href: "/brief", icon: Sun },
  { label: "Agent", href: "/agent", icon: Bot },
  { label: "Queue", href: "/queue", icon: ListChecks },
];

const NAV_BOTTOM = [{ label: "Analytics", href: "/analytics", icon: BarChart2 }];

const GOOGLE_APPS: Array<{ label: string; href: string; status: AppKey }> = [
  { label: "Mail", href: "/inbox", status: "gmail" },
  { label: "Calendar", href: "/calendar", status: "googlecalendar" },
  { label: "Drive", href: "/apps/drive", status: "googledrive" },
  { label: "Docs", href: "/apps/docs", status: "googledocs" },
  { label: "Sheets", href: "/apps/sheets", status: "googlesheets" },
  { label: "Meet", href: "/apps/meet", status: "googlemeet" },
];

const APPS_OPEN_KEY = "thread.nav.appsOpen";

function GoogleAppsGroup({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const { states } = useWorkspaceConnections();
  const activeIndex = GOOGLE_APPS.findIndex((a) => pathname === a.href);
  const childActive = activeIndex >= 0;
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(APPS_OPEN_KEY) === "false") setOpen(false);
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  const toggle = () => {
    setOpen((v) => {
      try {
        window.localStorage.setItem(APPS_OPEN_KEY, String(!v));
      } catch {
        /* storage blocked */
      }
      return !v;
    });
  };

  const connected = GOOGLE_APPS.filter((a) => states[a.status] === "connected").length;

  return (
    <div className="thread-nav-group" data-open={open}>
      <button
        type="button"
        className="thread-app-nav-item thread-nav-group-head"
        data-active={!open && childActive}
        aria-expanded={open}
        onClick={toggle}
      >
        <LayoutGrid size={16} />
        Google apps
        <span className="thread-nav-group-count">
          {connected}/{GOOGLE_APPS.length}
        </span>
        <ChevronDown size={14} className="thread-nav-group-chevron" />
      </button>
      <div
        className="thread-nav-tree"
        hidden={!open}
        style={activeIndex >= 0 ? ({ "--active-i": activeIndex } as CSSProperties) : undefined}
        data-has-active={activeIndex >= 0}
      >
        {GOOGLE_APPS.map((app) => {
          const active = pathname === app.href;
          const state = states[app.status];
          return (
            <Link
              key={app.href}
              href={app.href}
              className="thread-nav-leaf"
              data-active={active}
              onClick={onNavigate}
            >
              <span className="thread-nav-leaf-label">{app.label}</span>
              {state === "connected" ? (
                <i className="thread-nav-leaf-dot" aria-label="Connected" />
              ) : state === "loading" ? null : (
                <span className="thread-nav-leaf-off">Off</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const PAGE_META: Record<string, { title: string; sub: string }> = {
  "/brief": { title: "Daily Brief", sub: "Your plan for today — at a glance" },
  "/inbox": { title: "Inbox", sub: "Triage what matters" },
  "/queue": { title: "Queue", sub: "Approve before anything sends" },
  "/calendar": { title: "Calendar", sub: "Schedule without switching tabs" },
  "/agent": { title: "Agent", sub: "AI assistant — always through Queue" },
  "/analytics": { title: "Analytics", sub: "Queue activity & trends" },
  "/settings": { title: "Settings", sub: "Account & connections" },
  "/apps/drive": { title: "Drive", sub: "Files Thread can save and organise" },
  "/apps/docs": { title: "Docs", sub: "Documents the agent can read and write" },
  "/apps/sheets": { title: "Sheets", sub: "Spreadsheets from your data" },
  "/apps/meet": { title: "Meet", sub: "Meetings, links and transcripts" },
};

export function ThreadAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, isError } = useThreadUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const queueCountQuery = trpc.queue.pendingCount.useQuery({});
  const queueCount = queueCountQuery.data?.count ?? 0;
  useSyncEvents();

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
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }

      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const navLinks = (
    <>
      <span className="thread-app-nav-label">Workspace</span>
      {NAV_TOP.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="thread-app-nav-item"
          data-active={pathname === item.href}
          onClick={() => setMobileNavOpen(false)}
        >
          <item.icon size={16} />
          {item.label}
          {item.href === "/queue" && queueCount > 0 && <span className="thread-app-nav-count">{queueCount}</span>}
        </Link>
      ))}
      <GoogleAppsGroup pathname={pathname ?? ""} onNavigate={() => setMobileNavOpen(false)} />
      {NAV_BOTTOM.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="thread-app-nav-item"
          data-active={pathname === item.href}
          onClick={() => setMobileNavOpen(false)}
        >
          <item.icon size={16} />
          {item.label}
        </Link>
      ))}

      <span className="thread-app-nav-label">Account</span>
      <Link
        href="/settings"
        className="thread-app-nav-item"
        data-active={pathname === "/settings"}
        onClick={() => setMobileNavOpen(false)}
      >
        <Settings size={16} />
        Settings
      </Link>
    </>
  );

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
      {mobileNavOpen ? (
        <button
          type="button"
          className="thread-app-mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside className="thread-app-side" data-open={mobileNavOpen ? "true" : undefined}>
        <div className="thread-app-side-head">
          <Link href="/inbox" className="thread-app-side-brand" onClick={() => setMobileNavOpen(false)}>
            <Image src="/thread-logo.svg" alt="Thread" width={24} height={24} priority />
            <ThreadWordmark size="sm" />
          </Link>
          <button
            type="button"
            className="thread-app-mobile-close"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <nav className="thread-app-nav">{navLinks}</nav>

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
                // Remote Google avatar; next/image remote config is overkill for a 28px chip.
                // eslint-disable-next-line @next/next/no-img-element
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

      <ColumnResizer
        cssVar="--app-side-w"
        storageKey="thread.layout.sidebar"
        defaultWidth={252}
        min={200}
        max={360}
        side="left"
        label="Resize sidebar"
      />

      <div className="thread-app-main">
        <header className="thread-app-topbar">
          <button
            type="button"
            className="thread-app-mobile-menu-btn thread-app-iconbtn"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={16} />
          </button>

          <button
            type="button"
            className="thread-app-mobile-cmd thread-app-iconbtn"
            aria-label="Open command palette"
            onClick={() => setCmdOpen(true)}
          >
            <Search size={16} />
          </button>

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
            <ThreadWorkspaceConnect />
          </div>
        </header>

        <main className="thread-app-content">{children}</main>
      </div>

      <ThreadCommand
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
