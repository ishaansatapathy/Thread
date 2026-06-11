"use client";

import Link from "next/link";
import { Github, ArrowRight } from "lucide-react";
import { ThreadLogoMark, ThreadWordmark } from "./thread-logo";
import { useThreadAuth } from "./thread-auth-provider";
import { useThreadUser } from "~/components/app/use-thread-user";

const NAV = [
  { label: "How it works", href: "#how" },
  { label: "Workflows", href: "#workflows" },
  { label: "Integrations", href: "#integrations" },
  { label: "Agent", href: "#agent" },
  { label: "FAQ", href: "#faq" },
];

export function ThreadNav() {
  const { openAuth } = useThreadAuth();
  const { user, isLoading } = useThreadUser();

  return (
    <header className="thread-nav">
      <div className="thread-nav-inner">
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <ThreadLogoMark size={26} />
          <ThreadWordmark size="sm" />
        </Link>

        <nav className="thread-nav-links" style={{ display: "flex", gap: 2 }}>
          {NAV.map((item) => (
            <a key={item.label} href={item.href} className="thread-nav-link">
              {item.label}
            </a>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              border: "1px solid var(--thread-line)",
              display: "grid",
              placeItems: "center",
              color: "var(--thread-muted)",
            }}
          >
            <Github size={15} />
          </a>
          {user ? (
            <Link href="/inbox" className="thread-btn-accent" style={{ gap: 7 }}>
              Open Thread
              <ArrowRight size={15} />
            </Link>
          ) : (
            <>
              <button
                type="button"
                className="thread-btn-ghost thread-nav-login"
                onClick={() => openAuth("sign-in")}
                style={{ opacity: isLoading ? 0.7 : 1 }}
              >
                Log in
              </button>
              <button type="button" className="thread-btn-accent" onClick={() => openAuth("sign-in")}>
                Connect Gmail
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
