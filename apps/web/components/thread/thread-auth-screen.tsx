"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThreadAuthCard } from "./thread-auth-card";
import { ThreadLogoMark, ThreadWordmark } from "./thread-logo";

type AuthMode = "sign-in" | "sign-up";

const AUTH_NAV = [
  { label: "Workspace", href: "/#workspace" },
  { label: "How it works", href: "/#how" },
  { label: "Agent", href: "/#agent" },
  { label: "FAQ", href: "/#faq" },
];

// Knots sit on the segment endpoints of THREAD_PATH so the line passes exactly through them.
const KNOTS = [
  { x: 100, y: 64, label: "Gmail", above: true },
  { x: 220, y: 156, label: "Calendar", above: false },
  { x: 340, y: 72, label: "Drive", above: true },
  { x: 460, y: 150, label: "Docs", above: false },
  { x: 580, y: 88, label: "Meet", above: true },
];

const THREAD_PATH =
  "M -40 112 C 20 112, 50 64, 100 64 S 170 156, 220 156 S 290 72, 340 72 S 410 150, 460 150 S 530 88, 580 88 S 650 112, 720 112";

function ThreadLine() {
  return (
    <svg className="thread-auth-line" viewBox="0 0 660 220" aria-hidden>
      <defs>
        <linearGradient id="thread-auth-line-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#3b6cf6" stopOpacity="0" />
          <stop offset="0.18" stopColor="#3b6cf6" />
          <stop offset="0.7" stopColor="#6d93ff" />
          <stop offset="1" stopColor="#93b4ff" />
        </linearGradient>
        <filter id="thread-auth-line-blur" x="-10%" y="-50%" width="120%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <path className="thread-auth-line-glow" d={THREAD_PATH} pathLength={1} filter="url(#thread-auth-line-blur)" />
      <path className="thread-auth-line-path" d={THREAD_PATH} pathLength={1} />
      {KNOTS.map((k, i) => (
        <g key={k.label} className="thread-auth-knot" style={{ "--i": i } as CSSProperties}>
          <circle cx={k.x} cy={k.y} r={9} className="thread-auth-knot-ring" />
          <circle cx={k.x} cy={k.y} r={3.5} className="thread-auth-knot-dot" />
          <text x={k.x} y={k.above ? k.y - 22 : k.y + 32} textAnchor="middle">
            {k.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function AuthStory({ mode }: { mode: AuthMode }) {
  const isLogin = mode === "sign-in";
  return (
    <section className="thread-auth-story" aria-hidden>
      <span className="thread-auth-story-eyebrow">Thread — AI chief of staff for Google Workspace</span>

      <h2 className="thread-auth-story-title">
        {isLogin ? (
          <>
            <span className="thread-auth-story-dim">Pick up</span>
            <span>
              the <em>thread.</em>
            </span>
          </>
        ) : (
          <>
            <span className="thread-auth-story-dim">Every loose end,</span>
            <span>
              <em>tied.</em>
            </span>
          </>
        )}
      </h2>

      <p className="thread-auth-story-sub">
        {isLogin
          ? "Your inbox, calendar and docs — right where you left them, with the next move already drafted."
          : "Connect Google once. Thread reads across your workspace and only acts when you say go."}
      </p>

      <ThreadLine />
    </section>
  );
}

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

  const brandInner = (
    <>
      <ThreadLogoMark size={24} />
      <ThreadWordmark size="sm" />
    </>
  );

  return (
    <div className="thread-page thread-auth-screen">
      <div className="thread-auth-glow" aria-hidden />

      <header className="thread-auth-screen-nav">
        <div className="thread-auth-screen-nav-inner">
          {onClose ? (
            <button type="button" className="thread-auth-screen-brand" onClick={onClose}>
              {brandInner}
            </button>
          ) : (
            <Link href="/" className="thread-auth-screen-brand">
              {brandInner}
            </Link>
          )}
          <nav className="thread-auth-screen-links" aria-label="Site">
            {AUTH_NAV.map((item) => (
              <a key={item.label} href={item.href} className="thread-auth-screen-link">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="thread-auth-screen-nav-end">
            {onClose ? (
              <button type="button" className="thread-auth-back" onClick={onClose}>
                <ArrowLeft size={14} />
                Back
              </button>
            ) : (
              <Link href="/" className="thread-auth-back">
                <ArrowLeft size={14} />
                Back to home
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="thread-auth-screen-main">
        <AuthStory mode={mode} />
        <div className="thread-auth-card-wrap">
          <ThreadAuthCard
            mode={mode}
            onModeChange={setMode}
            errorMessage={errorMessage}
            nextPath={nextPath}
            pendingTwoFactorEmail={pendingTwoFactorEmail}
          />
          <p className="thread-auth-legal">Protected by Cloudflare · Nothing sends without your approval</p>
        </div>
      </main>
    </div>
  );
}
