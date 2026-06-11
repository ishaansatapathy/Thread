"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ClientRoughNotation } from "../ui/client-rough-notation";

/** Reveals children on scroll into view (once). */
export function Reveal({
  children,
  delay = 0,
  className,
  style,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={["thread-reveal", className].filter(Boolean).join(" ")}
      data-shown={shown}
      style={{ transitionDelay: `${delay}ms`, ...style }}
    >
      {children}
    </Tag>
  );
}

/**
 * Restrained ChaiPoll-style annotation: rough-notation that only animates
 * once the keyword scrolls into view. Defaults to a subtle blue underline.
 */
export function InViewAnnotation({
  children,
  type = "underline",
  color = "#3b82f6",
  strokeWidth = 2,
  delay = 200,
  multiline = false,
}: {
  children: ReactNode;
  type?: "underline" | "box" | "circle" | "highlight" | "bracket";
  color?: string;
  strokeWidth?: number;
  delay?: number;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { threshold: 0.9 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span ref={ref} style={{ position: "relative", whiteSpace: "nowrap" }}>
      <ClientRoughNotation
        type={type}
        show={show}
        color={color}
        strokeWidth={strokeWidth}
        padding={type === "underline" ? 2 : 4}
        animationDuration={700}
        animationDelay={delay}
        multiline={multiline}
        iterations={2}
      >
        {children}
      </ClientRoughNotation>
    </span>
  );
}
