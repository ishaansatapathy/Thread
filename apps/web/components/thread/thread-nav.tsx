"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Github, ArrowRight, Menu, X } from "lucide-react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="thread-nav">
      <div className="thread-nav-inner">
        <Link
          href="/"
          className="thread-nav-brand"
          onClick={closeMenu}
        >
          <ThreadLogoMark size={26} />
          <ThreadWordmark size="sm" />
        </Link>

        <nav className="thread-nav-links" aria-label="Primary">
          {NAV.map((item) => (
            <a key={item.label} href={item.href} className="thread-nav-link">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="thread-nav-actions">
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="thread-nav-icon-btn"
          >
            <Github size={15} />
          </a>
          {user ? (
            <Link href="/inbox" className="thread-btn-accent thread-nav-cta" onClick={closeMenu}>
              <span className="thread-nav-cta-text">Open Thread</span>
              <ArrowRight size={15} />
            </Link>
          ) : (
            <>
              <button
                type="button"
                className="thread-btn-ghost thread-nav-login"
                onClick={() => {
                  closeMenu();
                  openAuth("sign-in");
                }}
                style={{ opacity: isLoading ? 0.7 : 1 }}
              >
                Log in
              </button>
              <button
                type="button"
                className="thread-btn-accent thread-nav-cta"
                onClick={() => {
                  closeMenu();
                  openAuth("sign-in");
                }}
              >
                <span className="thread-nav-cta-text">Connect Gmail</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="thread-nav-menu-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <>
          <button
            type="button"
            className="thread-nav-mobile-backdrop"
            aria-label="Close menu"
            onClick={closeMenu}
          />
          <nav className="thread-nav-mobile-panel" aria-label="Mobile">
            {NAV.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="thread-nav-mobile-link"
                onClick={closeMenu}
              >
                {item.label}
              </a>
            ))}
            <a href="/privacy" className="thread-nav-mobile-link" onClick={closeMenu}>
              Privacy Policy
            </a>
            {user ? (
              <Link href="/inbox" className="thread-btn-accent" onClick={closeMenu}>
                Open Thread
              </Link>
            ) : (
              <button
                type="button"
                className="thread-btn-accent"
                onClick={() => {
                  closeMenu();
                  openAuth("sign-in");
                }}
              >
                Connect Gmail
              </button>
            )}
          </nav>
        </>
      ) : null}
    </header>
  );
}
