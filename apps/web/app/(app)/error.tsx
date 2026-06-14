"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Thread app error:", error);
  }, [error]);

  return (
    <div className="thread-app-page" style={{ display: "grid", placeItems: "center", minHeight: "60vh", padding: 24 }}>
      <div className="thread-rotator-bubble" style={{ flexDirection: "column", alignItems: "flex-start", gap: 12, maxWidth: 420 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Something went wrong</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--thread-muted)" }}>
          This page hit an unexpected error. You can retry or return to your inbox.
        </p>
        {error.digest ? (
          <p style={{ margin: 0, fontSize: 11, color: "var(--thread-dim)" }}>Reference: {error.digest}</p>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="thread-btn-accent" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/inbox" className="thread-btn-ghost" style={{ display: "inline-flex", alignItems: "center" }}>
            Go to Inbox
          </Link>
        </div>
      </div>
    </div>
  );
}
