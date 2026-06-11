"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";

import "~/components/thread/thread.css";
import { ThreadLogoMark, ThreadWordmark } from "~/components/thread/thread-logo";

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email")?.trim() || "your inbox";

  return (
    <div className="thread-page thread-auth-page">
      <header className="thread-auth-page-header">
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <ThreadLogoMark size={26} />
          <ThreadWordmark size="sm" />
        </Link>
      </header>
      <main className="thread-auth-page-main">
        <div className="thread-check-email">
          <ThreadLogoMark size={44} />
          <div
            style={{
              margin: "20px auto 0",
              width: 52,
              height: 52,
              borderRadius: 12,
              border: "1px solid var(--thread-line)",
              display: "grid",
              placeItems: "center",
              color: "var(--thread-accent-bright)",
            }}
          >
            <Mail size={22} />
          </div>
          <h1>Check your email</h1>
          <p>
            We sent a verification link to <strong>{email}</strong>. Open it to finish setting up Thread.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link href="/sign-in" className="thread-btn-ghost" style={{ display: "inline-flex", textDecoration: "none" }}>
              Back to log in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense>
      <CheckEmailContent />
    </Suspense>
  );
}
