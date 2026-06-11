"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Loader2, Mail, Plus, Settings2 } from "lucide-react";

import { trpc } from "~/trpc/client";

export function ThreadGmailConnect() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const statusQuery = trpc.inbox.connectionStatus.useQuery({});

  const connectHref = `/api-connect/gmail?state=${encodeURIComponent(pathname || "/inbox")}`;
  const gmailStatus = statusQuery.data?.gmail ?? "not_configured";
  const isConnected = gmailStatus === "connected";
  const isLoading = statusQuery.isLoading;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (isLoading) {
    return (
      <span className="thread-gmail-connect thread-gmail-connect--loading" aria-label="Checking Gmail">
        <Loader2 size={14} className="thread-spin" />
      </span>
    );
  }

  if (!isConnected) {
    return (
      <a href={connectHref} className="thread-btn-accent">
        Connect Gmail
      </a>
    );
  }

  return (
    <div className="thread-gmail-connect" ref={rootRef}>
      <button
        type="button"
        className="thread-gmail-connect-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="thread-gmail-connect-dot" aria-hidden />
        <Mail size={14} />
        <span>Gmail</span>
        <span className="thread-gmail-connect-label">Connected</span>
        <ChevronDown size={14} className="thread-gmail-connect-chevron" data-open={open} />
      </button>

      {open ? (
        <div className="thread-gmail-connect-menu" role="menu">
          <div className="thread-gmail-connect-menu-head">
            <span className="thread-gmail-connect-menu-title">Inbox account</span>
            <span className="thread-gmail-connect-menu-badge">Active</span>
          </div>
          <p className="thread-gmail-connect-menu-copy">
            Syncing through Corsair. Tokens stay encrypted in your database.
          </p>
          <div className="thread-gmail-connect-menu-sep" />
          <a
            href={connectHref}
            className="thread-app-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Plus size={14} />
            Add another Gmail
          </a>
          <Link
            href="/settings"
            className="thread-app-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Settings2 size={14} />
            Manage connections
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function ThreadGmailConnectMenuItem({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const statusQuery = trpc.inbox.connectionStatus.useQuery({});
  const connectHref = `/api-connect/gmail?state=${encodeURIComponent(pathname || "/inbox")}`;
  const isConnected = statusQuery.data?.gmail === "connected";

  return (
    <a href={connectHref} className="thread-app-menu-item" onClick={onNavigate}>
      <Mail size={14} />
      {isConnected ? "Add another Gmail" : "Connect Gmail"}
    </a>
  );
}
