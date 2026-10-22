"use client";

import { Loader2 } from "lucide-react";
import React, { type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

const variantClasses: Readonly<Record<ButtonVariant, string>> = {
  primary:
    "min-h-[64px] w-full rounded-full bg-primary px-6 py-4 text-[19px] font-bold text-white shadow-card hover:bg-primary-strong disabled:bg-surface-tint disabled:text-text-muted",
  secondary:
    "min-h-[48px] w-full rounded-full bg-surface-tint px-5 py-3 text-base font-semibold text-text hover:bg-divider disabled:bg-surface-tint disabled:text-text-muted",
  ghost:
    "min-h-[48px] rounded-full px-4 py-2.5 text-base font-semibold text-primary-strong hover:bg-surface-tint disabled:text-text-muted",
};

export function Button({
  variant = "primary",
  loading = false,
  icon,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled || loading);

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-disabled={isDisabled ? "true" : "false"}
      className={`inline-flex items-center justify-center gap-3 transition-colors ${variantClasses[variant]} ${className}`.trim()}
      {...rest}
    >
      {loading ? (
        <>
          <Loader2
            aria-hidden="true"
            className="h-5 w-5 shrink-0 motion-safe:animate-spin"
          />
          <span>Please wait</span>
        </>
      ) : (
        <>
          {icon && <span aria-hidden="true">{icon}</span>}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}
