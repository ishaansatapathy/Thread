"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, Calendar, FlaskConical, Mail, Sparkles, X } from "lucide-react";
import { useDemoMode, type DemoFeature } from "~/hooks/use-demo-mode";

interface DemoBarProps {
  email: string | null | undefined;
}

const FEATURE_LINKS: { feature: DemoFeature; href: string; icon: typeof Bot }[] = [
  { feature: "agent", href: "/agent", icon: Bot },
  { feature: "calendar", href: "/calendar", icon: Calendar },
  { feature: "mail", href: "/inbox", icon: Sparkles },
];

export function DemoBar({ email }: DemoBarProps) {
  const { isDemo, limits } = useDemoMode(email);
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (sessionStorage.getItem("thread_demo_bar_dismissed") === "1") {
      setDismissed(true);
    }
  }, []);

  if (!mounted || !isDemo || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("thread_demo_bar_dismissed", "1");
  };

  const allExhausted = FEATURE_LINKS.every(({ feature }) => limits[feature].isExhausted);

  return (
    <div className="thread-demo-bar" role="status" aria-label="Demo workspace">
      <div className="thread-demo-bar-main">
        <FlaskConical size={13} className="thread-demo-bar-icon" aria-hidden />
        <span className="thread-demo-bar-label">Demo limits</span>
        <span className="thread-demo-bar-sep" aria-hidden />
        <div className="thread-demo-bar-features">
          {FEATURE_LINKS.map(({ feature, href, icon: Icon }) => {
            const state = limits[feature];
            return (
              <Link
                key={feature}
                href={href}
                className="thread-demo-bar-feature"
                data-state={state.isExhausted ? "exhausted" : state.remaining <= 1 ? "low" : "ok"}
              >
                <Icon size={11} />
                {state.label} {state.remaining}/{state.limit}
              </Link>
            );
          })}
        </div>
        {allExhausted ? (
          <span className="thread-demo-bar-count" data-state="exhausted">
            All demo AI used
          </span>
        ) : null}
      </div>
      <div className="thread-demo-bar-actions">
        <Link href="/settings" className="thread-demo-bar-cta">
          <Mail size={12} />
          Connect Gmail
        </Link>
        <button type="button" className="thread-demo-bar-dismiss" aria-label="Dismiss" onClick={handleDismiss}>
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
