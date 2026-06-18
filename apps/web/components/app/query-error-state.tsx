"use client";

import type { CSSProperties } from "react";
import { AlertTriangle } from "lucide-react";

type QueryErrorStateProps = {
  title: string;
  message?: string;
  onRetry: () => void;
  className?: string;
  style?: CSSProperties;
};

export function QueryErrorState({ title, message, onRetry, className, style }: QueryErrorStateProps) {
  return (
    <div className={className ?? "thread-app-empty"} style={style}>
      <AlertTriangle size={22} style={{ opacity: 0.45, color: "#f87171" }} />
      <h2>{title}</h2>
      {message ? <p>{message}</p> : null}
      <button type="button" className="thread-btn-accent" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
