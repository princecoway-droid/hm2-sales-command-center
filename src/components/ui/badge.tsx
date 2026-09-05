import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "accent" | "positive" | "muted";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  accent: "bg-sky-50 text-sky-800 ring-sky-200",
  positive: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  muted: "bg-slate-50 text-slate-500 ring-slate-200",
};

type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
};

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
