import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "accent" | "positive" | "muted";

/**
 * Tinted rather than filled, and ringed rather than bordered.
 *
 * A badge sits on a translucent surface, so the fill is kept light enough that
 * the surface still reads as glass underneath it and the ring does the work of
 * defining the shape.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-900/[0.05] text-slate-700 ring-slate-900/10",
  accent: "bg-sky-500/10 text-sky-800 ring-sky-600/20",
  positive: "bg-emerald-500/10 text-emerald-800 ring-emerald-600/20",
  muted: "bg-slate-900/[0.03] text-slate-500 ring-slate-900/[0.08]",
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
