"use client";

import { STATUS_DOT_CLASSES } from "@/components/ui/status-styles";
import type { CompletenessSummary } from "@/lib/calculations/performance";
import { cn } from "@/lib/utils";
import type { HM } from "@/types/models";

type DataStatusProps = {
  summary: CompletenessSummary;
  hms: readonly HM[];
  /** Sales weeks configured for the month. Zero is worth calling out. */
  weekCount: number;
};

/**
 * Whether this month has actually been keyed in.
 *
 * Deliberately just counts. The one job is to stop a manager reading a
 * half-entered month as a finished one, and any cleverer scoring would be a
 * judgement the data cannot support - an HM can legitimately have a zero week,
 * so "has figures" is the only honest signal available.
 */
export function DataStatus({ summary, hms, weekCount }: DataStatusProps) {
  const namesById = new Map(hms.map((hm) => [hm.id, hm.name] as const));
  const missing = summary.missingHmIds
    .map((id) => namesById.get(id))
    .filter((name): name is string => Boolean(name));

  const tone =
    summary.level === "complete"
      ? "green"
      : summary.level === "partial"
        ? "yellow"
        : "red";

  const headline =
    summary.total === 0
      ? "No active HMs to enter"
      : summary.level === "complete"
        ? "Complete — every active HM has figures"
        : `${summary.withData} of ${summary.total} HM records updated`;

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-sm">
      <p className="flex items-center gap-2 font-medium text-slate-900">
        <span
          aria-hidden
          className={cn("size-2 rounded-full", STATUS_DOT_CLASSES[tone])}
        />
        {headline}
      </p>

      {missing.length > 0 ? (
        <p className="text-slate-500">
          <span className="text-slate-600">Nothing entered yet:</span>{" "}
          {missing.join(", ")}
        </p>
      ) : null}

      {weekCount === 0 ? (
        <p className="text-amber-700">
          No sales weeks configured — add the Coway periods before entering
          Key-In.
        </p>
      ) : null}
    </div>
  );
}
