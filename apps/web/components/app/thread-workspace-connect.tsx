"use client";

import { Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  HardDrive,
  LayoutGrid,
  Loader2,
  Mail,
  Settings2,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { trpc } from "~/trpc/client";

export type AppKey ="gmail" | "googlecalendar" | "googledrive" | "googlesheets" | "googledocs" | "googlemeet";
type ConnectionState = "connected" | "missing_credentials" | "not_connected" | "not_configured" | "loading";

type AppRow = {
  key: AppKey;
  label: string;
  hint: string;
  icon: ComponentType<{ size?: number }>;
  connectPath: string;
  /** Docs has no grant of its own — it rides on the Drive connection. */
  via?: AppKey;
};

export const WORKSPACE_APPS: AppRow[] = [
  { key: "gmail", label: "Gmail", hint: "Inbox, drafts, sending", icon: Mail, connectPath: "/api-connect/gmail" },
  { key: "googlecalendar", label: "Calendar", hint: "Events and invites", icon: Calendar, connectPath: "/api-connect/calendar" },
  { key: "googledrive", label: "Drive", hint: "Save and organise files", icon: HardDrive, connectPath: "/api-connect/workspace/googledrive" },
  { key: "googledocs", label: "Docs", hint: "Included with Drive", icon: FileText, connectPath: "/api-connect/workspace/googledrive", via: "googledrive" },
  { key: "googlesheets", label: "Sheets", hint: "Turn data into sheets", icon: FileSpreadsheet, connectPath: "/api-connect/workspace/googlesheets" },
  { key: "googlemeet", label: "Meet", hint: "Links and transcripts", icon: Video, connectPath: "/api-connect/workspace/googlemeet" },
];

const LABELS: Record<string, string> = Object.fromEntries(WORKSPACE_APPS.map((a) => [a.key, a.label]));

export function useWorkspaceConnections() {
  const gmail = trpc.inbox.connectionStatus.useQuery({});
  const calendar = trpc.calendar.connectionStatus.useQuery({});
  const workspace = trpc.workspace.connectionStatus.useQuery({}, { staleTime: 30_000 });

  const states: Record<AppKey, ConnectionState> = {
    gmail: gmail.isLoading ? "loading" : (gmail.data?.gmail ?? "not_configured"),
    googlecalendar: calendar.isLoading ? "loading" : (calendar.data?.googlecalendar ?? "not_configured"),
    googledrive: workspace.isLoading ? "loading" : (workspace.data?.googledrive ?? "not_configured"),
    googlesheets: workspace.isLoading ? "loading" : (workspace.data?.googlesheets ?? "not_configured"),
    googledocs: workspace.isLoading ? "loading" : (workspace.data?.googledrive ?? "not_configured"),
    googlemeet: workspace.isLoading ? "loading" : (workspace.data?.googlemeet ?? "not_configured"),
  };
  return { states, isLoading: gmail.isLoading || calendar.isLoading };
}

function stateLabel(state: ConnectionState) {
  switch (state) {
    case "connected":
      return "Connected";
    case "loading":
      return "Checking";
    case "not_configured":
      return "Unavailable";
    default:
      return "Not connected";
  }
}

export function WorkspaceAppList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { states } = useWorkspaceConnections();
  const returnTo = encodeURIComponent(pathname || "/inbox");

  return (
    <ul className="thread-ws-list">
      {WORKSPACE_APPS.map((app) => {
        const state = states[app.key];
        const connected = state === "connected";
        const unavailable = state === "not_configured";
        return (
          <li key={app.key} className="thread-ws-row" data-state={state}>
            <span className="thread-ws-icon">
              <app.icon size={15} />
            </span>
            <span className="thread-ws-meta">
              <span className="thread-ws-name">
                {app.label}
                <span className="thread-ws-state">
                  <i className="thread-ws-dot" aria-hidden />
                  {stateLabel(state)}
                </span>
              </span>
              <span className="thread-ws-hint">{app.hint}</span>
            </span>
            {state === "loading" ? (
              <Loader2 size={14} className="thread-spin" style={{ color: "var(--thread-dim)" }} />
            ) : unavailable || (app.via && connected) ? null : (
              <a
                href={`${app.connectPath}?state=${returnTo}`}
                className={connected ? "thread-ws-action" : "thread-ws-action thread-ws-action--primary"}
                onClick={onNavigate}
              >
                {connected ? "Reconnect" : "Connect"}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Handles ?workspace=connected / ?error=…&plugin=… after a Workspace OAuth round-trip. */
function useWorkspaceCallbackToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const utils = trpc.useUtils();

  useEffect(() => {
    const plugin = searchParams.get("plugin");
    if (!plugin || !["googledrive", "googlesheets", "googlemeet"].includes(plugin)) return;
    const label = LABELS[plugin];
    if (searchParams.get("workspace") === "connected") {
      toast.success(`${label} connected`);
    } else if (searchParams.get("error")) {
      toast.error(searchParams.get("error"));
    } else {
      return;
    }
    void utils.workspace.connectionStatus.invalidate();
    const next = new URLSearchParams(searchParams.toString());
    for (const key of ["workspace", "plugin", "error"]) next.delete(key);
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchParams, router, pathname, utils]);
}

function WorkspaceCallbackToast() {
  useWorkspaceCallbackToast();
  return null;
}

export function ThreadWorkspaceConnect() {
  return (
    <>
      <Suspense fallback={null}>
        <WorkspaceCallbackToast />
      </Suspense>
      <WorkspaceConnectMenu />
    </>
  );
}

function WorkspaceConnectMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { states, isLoading } = useWorkspaceConnections();

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (isLoading) {
    return (
      <span className="thread-gmail-connect thread-gmail-connect--loading" aria-label="Checking connections">
        <Loader2 size={14} className="thread-spin" />
      </span>
    );
  }

  const connectedCount = WORKSPACE_APPS.filter((a) => states[a.key] === "connected").length;
  const gmailMissing = states.gmail !== "connected";

  return (
    <div className="thread-gmail-connect" ref={rootRef}>
      <button
        type="button"
        className="thread-gmail-connect-btn thread-ws-trigger"
        data-attention={gmailMissing ? "true" : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="thread-ws-trigger-icon">
          <LayoutGrid size={13} />
        </span>
        <span className="thread-ws-trigger-label">{gmailMissing ? "Connect Gmail" : "Workspace"}</span>
        <span className="thread-ws-trigger-sep" aria-hidden />
        <span className="thread-ws-meter" aria-hidden>
          {WORKSPACE_APPS.map((a) => (
            <i key={a.key} data-on={states[a.key] === "connected"} />
          ))}
        </span>
        <span className="thread-ws-trigger-count">
          {connectedCount}
          <span>/{WORKSPACE_APPS.length}</span>
        </span>
        <ChevronDown size={13} className="thread-gmail-connect-chevron" data-open={open} />
      </button>

      {open ? (
        <div className="thread-gmail-connect-menu thread-ws-menu" role="dialog" aria-label="Google Workspace connections">
          <div className="thread-gmail-connect-menu-head">
            <span className="thread-gmail-connect-menu-title">Google Workspace</span>
            <span className="thread-gmail-connect-menu-badge">
              {connectedCount} of {WORKSPACE_APPS.length}
            </span>
          </div>
          <p className="thread-gmail-connect-menu-copy">
            Connect only what you use. Every change still waits in Queue for your approval.
          </p>
          <WorkspaceAppList onNavigate={() => setOpen(false)} />
          <div className="thread-gmail-connect-menu-sep" />
          <Link href="/settings" className="thread-app-menu-item" onClick={() => setOpen(false)}>
            <Settings2 size={14} />
            Manage connections
          </Link>
        </div>
      ) : null}
    </div>
  );
}
