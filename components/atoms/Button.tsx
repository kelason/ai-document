// components/atoms/Button.tsx
// ────────────────────────────
// Atom: Reusable button with variant, size, and loading state.

import React from "react";
import Spinner from "./Spinner";

const VARIANT_CLASSES = {
  primary:   "bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-sm shadow-indigo-600/20",
  secondary: "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800",
  danger:    "bg-red-600 hover:bg-red-500 active:bg-red-700 text-white shadow-sm shadow-red-600/20",
  ghost:     "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800",
} as const;

const SIZE_CLASSES = {
  xs: "px-2 py-1 text-[11px] rounded-lg gap-1",
  sm: "px-3 py-1.5 text-xs rounded-xl gap-1.5",
  md: "px-4 py-2 text-sm rounded-xl gap-2",
} as const;

type ButtonVariant = keyof typeof VARIANT_CLASSES;
type ButtonSize    = keyof typeof SIZE_CLASSES;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  ButtonVariant;
  size?:     ButtonSize;
  loading?:  boolean;
  icon?:     React.ReactNode;
  children?: React.ReactNode;
}

export default function Button({
  variant  = "secondary",
  size     = "sm",
  loading  = false,
  icon,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`inline-flex items-center justify-center font-semibold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${isDisabled ? "opacity-60 cursor-not-allowed" : ""} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
}
