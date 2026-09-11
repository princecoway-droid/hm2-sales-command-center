import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AlertTone = "info" | "warning" | "error" | "success";

/**
 * Tinted, not saturated.
 *
 * An error on this screen is usually a spreadsheet row a PA has to go and fix,
 * not an emergency, so the panel is a wash of its hue with a ring in the same
 * family - readable at a glance, and still legible next to eleven other things.
 * The tone still carries its `role`, so the meaning is not in the colour.
 */
const TONES: Record<AlertTone, string> = {
  info: "ring-sky-600/20 bg-sky-500/[0.07] text-sky-950",
  warning: "ring-amber-600/25 bg-amber-400/[0.12] text-amber-950",
  error: "ring-rose-600/25 bg-rose-500/[0.08] text-rose-950",
  success: "ring-emerald-600/20 bg-emerald-500/[0.08] text-emerald-950",
};

type AlertProps = {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  className?: string;
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: AlertProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-control px-4 py-3 text-sm ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {title ? (
        <p className="font-semibold tracking-tight">{title}</p>
      ) : null}
      <div className={cn(title && "mt-1")}>{children}</div>
    </div>
  );
}
