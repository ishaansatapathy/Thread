"use client";

import { useEffect, useState, type ReactNode } from "react";
import { RoughNotation, type RoughNotationProps } from "react-rough-notation";

type ClientRoughNotationProps = RoughNotationProps & {
  fallbackClassName?: string;
};

/** Avoid hydration mismatches — rough-notation only runs in the browser. */
export function ClientRoughNotation({
  children,
  fallbackClassName,
  ...props
}: ClientRoughNotationProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <span className={fallbackClassName}>{children}</span>;
  }

  return <RoughNotation {...props}>{children}</RoughNotation>;
}

export function ClientRoughText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={className}>{children}</span>;
}
