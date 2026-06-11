"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Position, getSmoothStepPath } from "@xyflow/react";

type ConnectorPath = { d: string; length: number };

function anchorPoint(el: HTMLElement, selector: string, container: DOMRect) {
  const anchor = el.querySelector<HTMLElement>(selector);
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  return {
    x: r.left + r.width / 2 - container.left,
    y: r.top + r.height / 2 - container.top,
  };
}

/** Line meets card edge at anchors — offset so path never crosses a visible dot. */
function zigzagAnchors(
  index: number,
  fromEl: HTMLElement,
  toEl: HTMLElement,
  container: DOMRect,
) {
  const goingRight = index % 2 === 0;
  const from = fromEl.getBoundingClientRect();
  const to = toEl.getBoundingClientRect();
  const pad = 2;

  const source =
    anchorPoint(fromEl, ".thread-flow-anchor--out", container) ??
    (goingRight
      ? {
          x: from.right - container.left,
          y: from.top + from.height * 0.58 - container.top,
        }
      : {
          x: from.left - container.left,
          y: from.top + from.height * 0.58 - container.top,
        });

  const target =
    anchorPoint(toEl, ".thread-flow-anchor--in", container) ??
    (goingRight
      ? {
          x: to.left + to.width * 0.14 - container.left,
          y: to.top - container.top,
        }
      : {
          x: to.right - to.width * 0.14 - container.left,
          y: to.top - container.top,
        });

  return {
    sourceX: source.x + (goingRight ? pad : -pad),
    sourceY: source.y,
    sourcePosition: goingRight ? Position.Right : Position.Left,
    targetX: target.x,
    targetY: target.y - pad,
    targetPosition: Position.Top,
  };
}

export function FlowDottedConnectors({
  cardRefs,
  edgeVisible,
}: {
  cardRefs: React.RefObject<(HTMLDivElement | null)[]>;
  edgeVisible: boolean[];
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [paths, setPaths] = useState<ConnectorPath[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const svg = svgRef.current;
      const parent = svg?.parentElement;
      if (!svg || !parent) return;

      const box = parent.getBoundingClientRect();
      const next: ConnectorPath[] = [];
      const cards = cardRefs.current;

      for (let i = 0; i < cards.length - 1; i++) {
        const fromEl = cards[i];
        const toEl = cards[i + 1];
        if (!fromEl || !toEl) continue;

        const anchors = zigzagAnchors(i, fromEl, toEl, box);

        const [d] = getSmoothStepPath({
          ...anchors,
          borderRadius: 14,
        });

        const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
        probe.setAttribute("d", d);
        next.push({ d, length: probe.getTotalLength() || 320 });
      }

      setPaths(next);
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });

    const ro = new ResizeObserver(measure);
    if (svgRef.current?.parentElement) ro.observe(svgRef.current.parentElement);
    cardRefs.current.forEach((el) => {
      if (el) ro.observe(el);
    });

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [cardRefs]);

  return (
    <svg ref={svgRef} className="thread-flow-dotted-svg" aria-hidden>
      <defs>
        <marker
          id="thread-flow-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 1 1 L 9 5 L 1 9 Z" fill="var(--thread-accent-bright)" />
        </marker>
      </defs>
      {paths.map((path, i) => (
        <path
          key={i}
          d={path.d}
          fill="none"
          stroke="var(--thread-accent-bright)"
          strokeWidth={1.5}
          strokeDasharray="6 5"
          strokeLinecap="round"
          markerEnd={edgeVisible[i] ? "url(#thread-flow-arrow)" : undefined}
          style={{
            strokeDashoffset: edgeVisible[i] ? 0 : path.length,
            opacity: edgeVisible[i] ? 0.7 : 0,
            transition: edgeVisible[i]
              ? "stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease"
              : "stroke-dashoffset 0.45s ease, opacity 0.3s ease",
          }}
        />
      ))}
    </svg>
  );
}
