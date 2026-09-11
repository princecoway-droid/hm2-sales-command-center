import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

/**
 * Three weights of the same control.
 *
 * `primary` is the only filled one on a screen, and it is filled rather than
 * tinted so it stays the obvious action over a translucent surface. `secondary`
 * is a glass chip - the same hairline and the same lit edge as the cards it
 * sits on. `ghost` carries no surface at all until it is pointed at.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-sky-700 text-white shadow-[0_1px_2px_rgb(15_23_42/0.18)] hover:bg-sky-800 active:bg-sky-900 focus-visible:outline-sky-700 disabled:bg-sky-700/50 disabled:shadow-none",
  secondary:
    "glass-chrome text-slate-700 ring-1 ring-inset ring-slate-900/10 shadow-[var(--shadow-control)] hover:bg-white hover:ring-slate-900/15 active:bg-slate-50 focus-visible:outline-sky-600",
  ghost:
    "bg-transparent text-slate-600 hover:bg-slate-900/[0.045] hover:text-slate-900 active:bg-slate-900/[0.07] focus-visible:outline-sky-600",
};

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        // A single height for every button on a screen, and 44px is the one
        // that is also a comfortable touch target on a phone.
        "inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2 text-sm font-medium",
        "transition-[background-color,box-shadow,color] duration-150 ease-out",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
