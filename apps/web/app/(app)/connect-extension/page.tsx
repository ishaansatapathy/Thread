"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, MonitorSmartphone, Puzzle } from "lucide-react";
import { toast } from "sonner";

const EXTENSION_ID = process.env.NEXT_PUBLIC_THREAD_EXTENSION_ID ?? "amjfmmikjmlcaacliifdkdnbjanlcipf";

type ExtensionReply = { ok: boolean; connected?: boolean; version?: string; error?: string } | null;

type ChromeRuntime = {
  sendMessage: (extensionId: string, message: unknown, callback: (reply: unknown) => void) => void;
  lastError?: { message?: string };
};

function chromeRuntime(): ChromeRuntime | null {
  const runtime = (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  return typeof runtime?.sendMessage === "function" ? runtime : null;
}

/** Messages the Thread extension (only reachable from origins listed in its manifest). */
function sendToExtension(message: unknown): Promise<ExtensionReply> {
  const runtime = chromeRuntime();
  if (!runtime) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      runtime.sendMessage(EXTENSION_ID, message, (reply) => {
        resolve(runtime.lastError ? null : ((reply as ExtensionReply) ?? null));
      });
    } catch {
      resolve(null);
    }
  });
}

type Phase = "checking" | "missing" | "ready" | "connecting" | "connected";

export default function ConnectExtensionPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ping = useCallback(async () => {
    const reply = await sendToExtension({ type: "thread:ping" });
    setPhase(reply?.ok ? (reply.connected ? "connected" : "ready") : "missing");
  }, []);

  useEffect(() => {
    void ping();
  }, [ping]);

  const connect = async () => {
    setPhase("connecting");
    try {
      const res = await fetch("/api-extension/token", {
        method: "POST",
        credentials: "include",
        headers: { "x-thread-csrf": "1" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        expiresAt?: string;
        email?: string;
        name?: string;
        error?: string;
      };
      if (!res.ok || !data.token) throw new Error(data.error ?? "Couldn't create a connection token.");

      // Fallback for when the extension can't be reached from this domain: a code to paste.
      setCode(btoa(JSON.stringify({ token: data.token, baseUrl: window.location.origin, email: data.email, name: data.name })));

      const reply = await sendToExtension({ type: "thread:connect", token: data.token, expiresAt: data.expiresAt, email: data.email, name: data.name });
      if (reply?.ok) {
        setPhase("connected");
        toast.success("Extension connected — open your Meet tab.");
      } else {
        setPhase("missing");
      }
    } catch (error) {
      setPhase("ready");
      toast.error(error instanceof Error ? error.message : "Couldn't connect the extension.");
    }
  };

  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="thread-app-content-narrow thread-appx">
      <header className="thread-appx-hero">
        <span className="thread-appx-hero-icon" data-on={phase === "connected"}>
          <Puzzle size={20} />
        </span>
        <div className="thread-appx-hero-meta">
          <h2>Thread for Google Meet</h2>
          <p>
            Live multilingual captions by Gnani, running notes and your agent — in a side panel right inside the Meet tab.
            No tab switching, no screen-share prompts.
          </p>
        </div>
        {phase === "connected" ? <span className="thread-appx-status">Connected</span> : null}
      </header>

      <section className="thread-appx-panel thread-ext">
        {phase === "checking" ? (
          <div className="thread-appx-empty">
            <Loader2 size={16} className="thread-spin" />
          </div>
        ) : phase === "connected" ? (
          <div className="thread-ext-body">
            <Check size={22} className="thread-ext-ok" />
            <h3>You&apos;re connected</h3>
            <p>
              Join or start a Google Meet, click the <strong>Thread</strong> icon in Chrome&apos;s toolbar (or press{" "}
              <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>), then press <strong>Start live transcript</strong>.
            </p>
            <button type="button" className="thread-room-btn" onClick={() => void connect()}>
              Reconnect
            </button>
          </div>
        ) : (
          <div className="thread-ext-body">
            {phase === "missing" && !code ? (
              <>
                <MonitorSmartphone size={22} />
                <h3>Install the extension first</h3>
                <ol className="thread-ext-steps">
                  <li>
                    Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong> (top right).
                  </li>
                  <li>
                    Click <strong>Load unpacked</strong> and choose the <code>apps/extension</code> folder of the Thread repo.
                  </li>
                  <li>Come back here and press Connect.</li>
                </ol>
              </>
            ) : (
              <>
                <Puzzle size={22} />
                <h3>Connect the extension to your account</h3>
                <p>Thread gives the extension its own key — it can be revoked any time by signing out of all devices.</p>
              </>
            )}
            <button type="button" className="thread-room-primary" onClick={() => void connect()} disabled={phase === "connecting"}>
              {phase === "connecting" ? <Loader2 size={14} className="thread-spin" /> : <Puzzle size={14} />}
              Connect extension
            </button>
            {phase === "missing" && !code ? (
              <button type="button" className="thread-room-btn" onClick={() => void ping()}>
                I&apos;ve installed it — check again
              </button>
            ) : null}
          </div>
        )}

        {code && phase !== "connected" ? (
          <div className="thread-ext-code">
            <p>
              The extension couldn&apos;t be reached from this page. Open the Thread side panel, choose{" "}
              <strong>Have a connection code?</strong> and paste this:
            </p>
            <div className="thread-ext-code-row">
              <code>{`${code.slice(0, 28)}…`}</code>
              <button type="button" className="thread-room-btn" onClick={() => void copyCode()}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy code"}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
