"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

type ColumnResizerProps = {
  /** CSS variable on the parent grid that holds the column width, e.g. "--inbox-list-w". */
  cssVar: `--${string}`;
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** Which edge of the grid the resized column hugs. */
  side: "left" | "right";
  /** Half the grid gap, so the handle sits centred in the gutter. */
  offset?: number;
  label: string;
};

const KEY_STEP = 16;

function readStored(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: number | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Storage unavailable (private mode) — the width just won't persist.
  }
}

/**
 * Drag handle placed as a direct child of a CSS grid. Dragging writes the
 * column width into a CSS variable on the grid, so the layout reflows without
 * React re-rendering on every pointer move.
 */
export function ColumnResizer({
  cssVar,
  storageKey,
  defaultWidth,
  min,
  max,
  side,
  offset = 0,
  label,
}: ColumnResizerProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const width = useRef(defaultWidth);

  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  const apply = (value: number) => {
    const grid = handleRef.current?.parentElement;
    if (!grid) return;
    width.current = value;
    grid.style.setProperty(cssVar, `${value}px`);
    handleRef.current?.setAttribute("aria-valuenow", String(Math.round(value)));
  };

  useLayoutEffect(() => {
    const stored = readStored(storageKey);
    if (stored != null && Number.isFinite(stored)) apply(clamp(stored));
    else handleRef.current?.setAttribute("aria-valuenow", String(defaultWidth));
    // Only restore once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = "true";
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const startX = event.clientX;
    const startWidth = width.current;
    const direction = side === "left" ? 1 : -1;

    const onMove = (move: globalThis.PointerEvent) => {
      apply(clamp(startWidth + (move.clientX - startX) * direction));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      delete handle.dataset.dragging;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      writeStored(storageKey, width.current);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const grow = (event.key === "ArrowRight") === (side === "left");
    const next = clamp(width.current + (grow ? KEY_STEP : -KEY_STEP));
    apply(next);
    writeStored(storageKey, next);
  };

  const reset = () => {
    apply(defaultWidth);
    handleRef.current?.parentElement?.style.removeProperty(cssVar);
    writeStored(storageKey, null);
  };

  return (
    <div
      ref={handleRef}
      className="thread-resizer"
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      style={{ [side]: `calc(var(${cssVar}, ${defaultWidth}px) + ${offset}px)` }}
      onPointerDown={onPointerDown}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    />
  );
}
