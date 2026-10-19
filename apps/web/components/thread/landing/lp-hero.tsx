"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { useThreadAuth } from "../thread-auth-provider";
import { useThreadUser } from "~/components/app/use-thread-user";
import { useScrollProgress } from "./use-scroll-progress";

const SERVICES = ["Gmail", "Calendar", "Drive", "Docs", "Sheets", "Meet", "Slides", "Forms", "Classroom"];

const SLAB_LAYERS = 9;

export function GetStartedButton({ label = "Get started" }: { label?: string }) {
  const { openAuth } = useThreadAuth();
  const { user } = useThreadUser();

  if (user) {
    return (
      <Link href="/inbox" className="lp-split-btn">
        <span className="lp-split-btn-label">Open Thread</span>
        <span className="lp-split-btn-icon">
          <ArrowRight size={16} />
        </span>
      </Link>
    );
  }

  return (
    <button type="button" className="lp-split-btn" onClick={() => openAuth("sign-in")}>
      <span className="lp-split-btn-label">{label}</span>
      <span className="lp-split-btn-icon">
        <ArrowRight size={16} />
      </span>
    </button>
  );
}

function IsoScene({ lift }: { lift: number }) {
  // Layers split apart as the hero scrolls away — top plate "breaks off" and rises highest.
  const style = { "--lift": lift } as CSSProperties;

  return (
    <div className="lp-iso-wrap" aria-hidden>
      <div className="lp-iso-scene" style={style}>
        <div className="lp-iso-ground">
          <span className="lp-iso-ground-label lp-iso-ground-label--a">WORKSPACE · SYNCED</span>
          <span className="lp-iso-ground-label lp-iso-ground-label--b">APPROVAL QUEUE</span>
        </div>
        <div className="lp-iso-ground lp-iso-ground--outer" />

        {Array.from({ length: SLAB_LAYERS }).map((_, i) => (
          <div
            key={i}
            className="lp-iso-slab"
            style={{ "--i": i, "--n": SLAB_LAYERS } as CSSProperties}
          />
        ))}

        <div className="lp-iso-slab-top">
          <svg viewBox="0 0 100 100" className="lp-iso-curve">
            <path d="M14 62 C 26 30, 38 78, 50 48 S 72 22, 86 40" />
          </svg>
          <span className="lp-iso-tag">GMAIL · 128 THREADS RANKED</span>
          {["tl", "tr", "bl", "br"].map((c) => (
            <i key={c} className={`lp-iso-dot lp-iso-dot--${c}`} />
          ))}
        </div>

        <div className="lp-iso-plate lp-iso-plate--mid">
          <span className="lp-iso-plate-title">CALENDAR</span>
          <span className="lp-iso-plate-sub">3 invites waiting for you</span>
          <div className="lp-iso-plate-grid">
            {Array.from({ length: 10 }).map((_, i) => (
              <i key={i} data-on={i === 3 || i === 6} />
            ))}
          </div>
        </div>

        <div className="lp-iso-plate lp-iso-plate--top">
          <span className="lp-iso-plate-title">MEET · LIVE</span>
          <span className="lp-iso-plate-sub">Dates extracted from transcript</span>
          <svg viewBox="0 0 100 40" className="lp-iso-wave">
            <path d="M0 20 Q 6 4 12 20 T 24 20 T 36 20 T 48 20 T 60 20 T 72 20 T 84 20 T 100 20" />
          </svg>
        </div>

        {["tl", "tr", "bl", "br"].map((c) => (
          <span key={c} className={`lp-iso-pillar lp-iso-pillar--${c}`} />
        ))}
      </div>
    </div>
  );
}

export function LpHero() {
  const [ref, progress] = useScrollProgress<HTMLElement>("sticky");
  const glowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = ref.current;
      const glow = glowRef.current;
      if (!section || !glow) return;
      const vh = window.innerHeight;
      const t = Math.min(1, Math.max(0, section.getBoundingClientRect().bottom / vh));
      glow.style.setProperty("--glow", (t * t * (3 - 2 * t)).toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref]);

  return (
    <section ref={ref} className="lp-hero" id="product">
      <div ref={glowRef} className="lp-hero-glow" aria-hidden />
      <div className="lp-hero-sticky">
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <h1 className="lp-hero-title">
              <span className="lp-hero-title-dim">Your AI chief of staff</span>
              <span>
                for Google <em>Workspace</em>
              </span>
            </h1>

            <p className="lp-hero-sub">
              Gmail, Calendar, Drive, Docs, Meet and more — one agent that reads everything, acts on a
              single prompt, and only sends when you say go.
            </p>

            <div className="lp-hero-actions">
              <GetStartedButton />
              <a href="#how" className="lp-text-link">
                See how it works <ArrowRight size={14} />
              </a>
            </div>
          </div>

          <IsoScene lift={progress} />
        </div>

        <div className="lp-hero-foot">
          <span className="lp-eyebrow">Works across your whole workspace</span>
          <div className="lp-hero-services">
            {SERVICES.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
