"use client";

import { useState } from "react";
import Link from "next/link";
import { ThreadAuthCard } from "./thread-auth-card";
import { ThreadLogoMark, ThreadWordmark } from "./thread-logo";

type AuthMode = "sign-in" | "sign-up";

const AUTH_NAV = [
  { label: "How it works", href: "/#how" },
  { label: "Workflows", href: "/#workflows" },
  { label: "Integrations", href: "/#integrations" },
  { label: "Agent", href: "/#agent" },
  { label: "FAQ", href: "/#faq" },
];

type ThreadAuthScreenProps = {
  mode?: AuthMode;
  errorMessage?: string;
  nextPath?: string;
  pendingTwoFactorEmail?: string;
  onClose?: () => void;
};

export function ThreadAuthScreen({
  mode: initialMode = "sign-in",
  errorMessage,
  nextPath,
  pendingTwoFactorEmail,
  onClose,
}: ThreadAuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  const brand = onClose ? (
    <button type="button" className="thread-auth-screen-brand" onClick={onClose}>
      <ThreadLogoMark size={24} />
      <ThreadWordmark size="sm" />
    </button>
  ) : (
    <Link href="/" className="thread-auth-screen-brand">
      <ThreadLogoMark size={24} />
      <ThreadWordmark size="sm" />
    </Link>
  );

  return (
    <div className="thread-page thread-auth-screen">
      <header className="thread-auth-screen-nav">
        <div className="thread-auth-screen-nav-inner">
          {brand}
          <nav className="thread-auth-screen-links" aria-label="Site">
            {AUTH_NAV.map((item) => (
              <a key={item.label} href={item.href} className="thread-auth-screen-link">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="thread-auth-screen-nav-end" />
        </div>
      </header>

      <main className="thread-auth-screen-main">
        <ThreadAuthCard
          mode={mode}
          onModeChange={setMode}
          errorMessage={errorMessage}
          nextPath={nextPath}
          pendingTwoFactorEmail={pendingTwoFactorEmail}
        />
      </main>
    </div>
  );
}
