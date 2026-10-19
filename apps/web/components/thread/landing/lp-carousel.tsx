"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./use-scroll-progress";

type Card = { id: string; app: string; tone: "dark" | "light" | "blue"; body: ReactNode };

const CARDS: Card[] = [
  {
    id: "gmail",
    app: "Gmail",
    tone: "dark",
    body: (
      <>
        <p className="lp-card-kicker">Priority · 3 need you</p>
        {[
          ["Priya Raman", "Contract redlines — need sign-off by Fri"],
          ["Arjun (Finance)", "Q3 budget sheet updated"],
          ["Design team", "Re: onboarding screens v2"],
        ].map(([from, subj], i) => (
          <div key={from} className="lp-card-mail" data-hot={i === 0}>
            <b>{from}</b>
            <span>{subj}</span>
          </div>
        ))}
      </>
    ),
  },
  {
    id: "slides",
    app: "Slides",
    tone: "blue",
    body: (
      <div className="lp-card-slide">
        <span className="lp-card-slide-num">01 / 12</span>
        <p className="lp-card-serif">
          Q3 roadmap,
          <br />
          <em>drafted for you.</em>
        </p>
        <span className="lp-card-foot">Generated from Monday&apos;s sync</span>
      </div>
    ),
  },
  {
    id: "meet",
    app: "Meet",
    tone: "dark",
    body: (
      <>
        <p className="lp-card-kicker">
          <i className="lp-rec-dot" /> Live transcript
        </p>
        <p className="lp-card-quote">“Launch review ko Thursday 4 baje rakhte hain.”</p>
        <p className="lp-card-quote lp-card-quote--dim">“And the vendor deadline is the 28th.”</p>
        <div className="lp-card-pill-row">
          <span className="lp-card-pill">2 dates found</span>
          <span className="lp-card-pill">→ Calendar</span>
        </div>
      </>
    ),
  },
  {
    id: "docs",
    app: "Docs",
    tone: "light",
    body: (
      <div className="lp-card-doc">
        <p className="lp-card-serif lp-card-serif--ink">Meeting notes</p>
        <span className="lp-card-doc-meta">Auto-written · 4 action items</span>
        {[82, 64, 90, 48, 70].map((w, i) => (
          <i key={i} style={{ width: `${w}%` }} />
        ))}
      </div>
    ),
  },
  {
    id: "calendar",
    app: "Calendar",
    tone: "dark",
    body: (
      <>
        <p className="lp-card-kicker">This week</p>
        <div className="lp-card-cal">
          {["M", "T", "W", "T", "F"].map((d, i) => (
            <div key={i} className="lp-card-cal-col">
              <span>{d}</span>
              <i data-on={i === 1} style={{ height: 18 + ((i * 13) % 30) }} />
              <i data-ghost={i === 3} style={{ height: 14 + ((i * 7) % 18) }} />
            </div>
          ))}
        </div>
        <span className="lp-card-foot">Launch review · Thu 16:00 · queued</span>
      </>
    ),
  },
  {
    id: "sheets",
    app: "Sheets",
    tone: "dark",
    body: (
      <>
        <p className="lp-card-kicker">Budget tracker</p>
        <div className="lp-card-sheet">
          {Array.from({ length: 15 }).map((_, i) => (
            <i key={i} data-hd={i < 3} data-hit={i === 7} />
          ))}
        </div>
        <span className="lp-card-foot">Row 4 updated from Arjun&apos;s email</span>
      </>
    ),
  },
  {
    id: "drive",
    app: "Drive",
    tone: "dark",
    body: (
      <>
        <p className="lp-card-kicker">Shared with you</p>
        {["Vendor contract v3.pdf", "Brand kit", "Interview loop.xlsx"].map((f) => (
          <div key={f} className="lp-card-file">
            <i />
            <span>{f}</span>
          </div>
        ))}
      </>
    ),
  },
  {
    id: "classroom",
    app: "Classroom",
    tone: "light",
    body: (
      <div className="lp-card-doc">
        <p className="lp-card-serif lp-card-serif--ink">Physics · Unit 4</p>
        <span className="lp-card-doc-meta">Due Monday · 28 of 32 submitted</span>
        <div className="lp-card-bar">
          <i style={{ width: "87%" }} />
        </div>
        <span className="lp-card-doc-meta">Reminder drafted for 4 students</span>
      </div>
    ),
  },
  {
    id: "forms",
    app: "Forms",
    tone: "dark",
    body: (
      <>
        <p className="lp-card-kicker">Event RSVP · 142 responses</p>
        {[
          ["Attending", 72],
          ["Maybe", 18],
          ["Can't make it", 10],
        ].map(([label, v]) => (
          <div key={label} className="lp-card-stat">
            <span>{label}</span>
            <div className="lp-card-bar">
              <i style={{ width: `${v}%` }} />
            </div>
          </div>
        ))}
      </>
    ),
  },
];

const SPACING = 236;

export function LpCarousel() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const n = CARDS.length;
    let offset = 0;
    let last = performance.now();
    let frame = 0;
    let visible = true;

    const layout = () => {
      const narrow = window.innerWidth < 760;
      const spacing = narrow ? SPACING * 0.62 : SPACING;
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        let x = (((i - offset) % n) + n) % n;
        if (x > n / 2) x -= n;
        const ax = Math.abs(x);
        const rotate = -x * 11;
        const z = -Math.pow(ax, 1.5) * 46;
        const lift = ax * ax * 3;
        el.style.transform = `translateX(${x * spacing}px) translateY(${lift}px) translateZ(${z}px) rotateY(${rotate}deg)`;
        el.style.opacity = String(Math.max(0, 1 - Math.max(0, ax - 2.4) * 0.9));
        el.style.zIndex = String(100 - Math.round(ax * 10));
        el.style.filter = ax > 1.6 ? `brightness(${Math.max(0.45, 1.2 - ax * 0.22)})` : "none";
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!reduced && visible) offset += dt * 0.00012;
      layout();
      frame = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    if (trackRef.current) io.observe(trackRef.current);

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, [reduced]);

  return (
    <section className="lp-section lp-carousel-section" id="workspace">
      <div className="lp-section-head lp-center">
        <span className="lp-eyebrow">One workspace</span>
        <h2 className="lp-title">
          Every app you use,
          <br />
          on <em>one</em> canvas
        </h2>
      </div>

      <div className="lp-carousel" ref={trackRef}>
        <div className="lp-carousel-stage">
          {CARDS.map((card, i) => (
            <div
              key={card.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              className="lp-card"
              data-tone={card.tone}
            >
              <div className="lp-card-body">{card.body}</div>
              <span className="lp-card-app">{card.app}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="lp-lede lp-center lp-carousel-lede">
        Thread pulls mail, meetings, files, sheets and classes into one place. Ask in plain language,
        in English or Hindi, and it drafts the reply, books the slot and builds the deck.
      </p>
    </section>
  );
}
