"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { getLenis } from "./lp-smooth-scroll";

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/**
 * "sticky": 0 when the section top hits the viewport top, 1 when its bottom hits the viewport bottom.
 * "pass":   0 when the section top enters the viewport bottom, 1 when its top reaches `endAt` of the viewport.
 */
export function useScrollProgress<T extends HTMLElement>(
  mode: "sticky" | "pass" = "sticky",
  endAt = 0.25,
): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const next =
        mode === "sticky"
          ? clamp(-rect.top / Math.max(1, rect.height - vh))
          : clamp((vh - rect.top) / Math.max(1, vh * (1 - endAt)));
      setProgress((prev) => (Math.abs(prev - next) < 0.0008 ? prev : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [mode, endAt]);

  return [ref, progress];
}

/** Scrolls the window so a sticky section sits at the given progress. */
export function scrollToProgress(el: HTMLElement | null, progress: number) {
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  const travel = el.offsetHeight - window.innerHeight;
  const target = top + travel * clamp(progress);
  const lenis = getLenis();
  if (lenis) lenis.scrollTo(target, { duration: 1.1 });
  else window.scrollTo({ top: target, behavior: "smooth" });
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export { clamp };
