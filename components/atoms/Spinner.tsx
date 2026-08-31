// components/atoms/Spinner.tsx
// ─────────────────────────────
// Atom: A simple, accessible loading indicator.
// Accepts an optional `size` prop ("sm" | "md" | "lg") and `label` for screen readers.

import React from "react";

const SIZE_MAP = {
  sm: "h-4 w-4 border-2",
  md: "h-8 w-8 border-2",
  lg: "h-12 w-12 border-[3px]",
} as const;

interface SpinnerProps {
  size?: keyof typeof SIZE_MAP;
  label?: string;
  className?: string;
}

export default function Spinner({
  size = "md",
  label = "Loading…",
  className = "",
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block animate-spin rounded-full border-zinc-200 dark:border-zinc-700 border-t-indigo-600 ${SIZE_MAP[size]} ${className}`}
    />
  );
}
