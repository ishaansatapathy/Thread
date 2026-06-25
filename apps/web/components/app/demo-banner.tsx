"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  FlaskConical,
  FileText,
  Zap,
  Bot,
  Mail,
  UserPlus,
  Clock,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useDemoMode } from "~/hooks/use-demo-mode";

interface DemoBannerProps {
  email: string | null | undefined;
}

/** Modal shown when an expired demo user tries an AI action. */
function DemoExpiredModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="thread-demo-expired-overlay" role="dialog" aria-modal aria-label="Demo session ended">
      <div className="thread-demo-expired-card">
        <div className="thread-demo-expired-icon">
          <Clock size={22} />
        </div>
        <h2 className="thread-demo-expired-title">Your demo has ended</h2>
        <p className="thread-demo-expired-body">
          10 minutes are up. Connect Gmail to keep going with your real inbox — or
          create a free account to save your session.
        </p>
        <div className="thread-demo-expired-ctas">
          <a href="/settings" className="thread-demo-expired-btn thread-demo-expired-btn--primary">
            <Mail size={14} />
            Connect Gmail
            <ArrowRight size={14} />
          </a>
          <a href="/sign-in" className="thread-demo-expired-btn thread-demo-expired-btn--ghost">
            <UserPlus size={14} />
            Create account
          </a>
        </div>
        <button type="button" className="thread-demo-expired-close" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function DemoBanner({ email }: DemoBannerProps) {
  const { isDemo, isDemoExpired, shouldShowWarning, markWarningSeen } = useDemoMode(email);
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showExpiredModal, setShowExpiredModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    const saved = sessionStorage.getItem("thread_demo_banner_dismissed");
    if (saved === "1") setDismissed(true);
  }, []);

  // Fire one-time 8-minute warning toast
  useEffect(() => {
    if (!shouldShowWarning) return;
    markWarningSeen();
    toast.warning("2 minutes left in demo", {
      description: "Connect Gmail or create an account to keep all features.",
      duration: 8000,
      action: {
        label: "Connect Gmail",
        onClick: () => router.push("/settings"),
      },
    });
  }, [shouldShowWarning, markWarningSeen, router]);

  if (!mounted || !isDemo || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("thread_demo_banner_dismissed", "1");
  };

  /** Intercept AI shortcut clicks when expired */
  const handleShortcut = (href: string) => {
    if (isDemoExpired) {
      setShowExpiredModal(true);
      return;
    }
    router.push(href);
  };

  const shortcuts = [
    { label: "Brief", icon: FileText, href: "/brief" },
    { label: "Summarize", icon: Zap, href: "/inbox" },
    { label: "Agent", icon: Bot, href: "/agent" },
  ];

  return (
    <>
      <div
        className="thread-demo-banner"
        role="complementary"
        aria-label="Demo mode notice"
      >
        {/* Header */}
        <div className="thread-demo-banner-head">
          <div className="thread-demo-banner-title">
            <FlaskConical size={14} className="thread-demo-banner-icon" />
            <span>Demo mode</span>
            {isDemoExpired && (
              <span className="thread-demo-expired-chip">Session ended</span>
            )}
          </div>
          <button
            type="button"
            className="thread-demo-dismiss"
            aria-label="Dismiss demo banner"
            onClick={handleDismiss}
          >
            <X size={13} />
          </button>
        </div>

        {/* Body */}
        {!isDemoExpired ? (
          <>
            <p className="thread-demo-desc">
              Sample mail &amp; calendar — real AI features
            </p>
            <div className="thread-demo-shortcuts">
              {shortcuts.map((s) => (
                <button
                  key={s.href}
                  type="button"
                  className="thread-demo-shortcut"
                  onClick={() => handleShortcut(s.href)}
                >
                  <s.icon size={12} />
                  {s.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="thread-demo-desc thread-demo-desc--expired">
            Your 10-min demo has ended.
          </p>
        )}

        {/* CTAs */}
        <div className="thread-demo-ctas">
          <button
            type="button"
            className="thread-demo-cta thread-demo-cta--primary"
            onClick={() => router.push("/settings")}
          >
            <Mail size={13} />
            Connect Gmail
          </button>
          <button
            type="button"
            className="thread-demo-cta thread-demo-cta--ghost"
            onClick={() => window.location.assign("/sign-in")}
          >
            <UserPlus size={13} />
            Create account
          </button>
        </div>
      </div>

      {showExpiredModal && (
        <DemoExpiredModal onClose={() => setShowExpiredModal(false)} />
      )}
    </>
  );
}

/**
 * Thin hook for AI-action pages (Agent, inbox summarize etc.) to intercept
 * clicks when the demo session has expired.
 *
 * Usage:
 *   const { guardDemoAction } = useDemoExpiredGuard(user?.email);
 *   // wrap any AI CTA: onClick={() => guardDemoAction(() => doAiThing())}
 */
export function useDemoExpiredGuard(email: string | null | undefined) {
  const { isDemoExpired } = useDemoMode(email);
  const [showModal, setShowModal] = useState(false);

  const guardDemoAction = (action: () => void) => {
    if (isDemoExpired) {
      setShowModal(true);
      return;
    }
    action();
  };

  const modal = showModal ? (
    <DemoExpiredModal onClose={() => setShowModal(false)} />
  ) : null;

  return { guardDemoAction, isDemoExpired, modal };
}
