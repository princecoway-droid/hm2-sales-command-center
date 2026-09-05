import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AlertTone = "info" | "warning" | "error" | "success";

const TONES: Record<AlertTone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
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
        "rounded-md border px-4 py-3 text-sm",
        TONES[tone],
        className,
      )}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={cn(title && "mt-1")}>{children}</div>
    </div>
  );
}
