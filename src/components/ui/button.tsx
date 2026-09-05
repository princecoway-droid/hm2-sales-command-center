import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-sky-700 text-white hover:bg-sky-800 focus-visible:outline-sky-700 disabled:bg-sky-700/50",
  secondary:
    "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-500",
  ghost:
    "bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:outline-slate-500",
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
        "inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
