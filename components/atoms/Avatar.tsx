// components/atoms/Avatar.tsx
// ────────────────────────────
// Atom: User avatar circle with initials and a configurable ring colour.

import React from "react";

interface AvatarProps {
  initials: string;
  color: string;       // CSS colour value used as background
  size?: "xs" | "sm" | "md" | "lg";
  title?: string;
  className?: string;
}

const SIZE_CLASSES = {
  xs: "w-5  h-5  text-[8px]",
  sm: "w-7  h-7  text-[10px]",
  md: "w-8  h-8  text-xs",
  lg: "w-10 h-10 text-sm",
} as const;

export default function Avatar({
  initials,
  color,
  size = "md",
  title,
  className = "",
}: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={title ?? initials}
      title={title}
      className={`inline-flex items-center justify-center rounded-full font-bold text-white ring-2 ring-white dark:ring-zinc-900 select-none shrink-0 ${SIZE_CLASSES[size]} ${className}`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  );
}
