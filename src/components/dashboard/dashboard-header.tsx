import type { ReactNode } from "react";

import { RefreshButton } from "@/components/dashboard/refresh-button";

type DashboardHeaderProps = {
  /** The month everything below is scoped to. Always shown, never implied. */
  monthLabel: string;
  quarterLabel: string;
  updatedLabel: string | null;
  /** The month switcher, when there is a month to switch away from. */
  controls?: ReactNode;
};

/**
 * The top of the command centre.
 *
 * The month is set as large as the title, because "which month am I looking
 * at" is the question every figure below depends on - and because the
 * dashboard legitimately shows a month other than today's, so it can never be
 * left to be inferred.
 *
 * The Updated stamp is the data's, not the clock's: it says when the figures
 * were last written, which is what tells a manager whether they are reading
 * this morning's numbers or last Tuesday's.
 */
export function DashboardHeader({
  monthLabel,
  quarterLabel,
  updatedLabel,
  controls,
}: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          HM2 Sales Command Center
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {monthLabel}
          <span className="ml-2 align-middle text-sm font-medium text-slate-400">
            {quarterLabel}
          </span>
        </h1>

        <p className="mt-1 text-xs text-slate-500">
          {updatedLabel ? (
            <>Updated {updatedLabel} (MYT)</>
          ) : (
            <>No figures recorded for this month yet</>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {controls}
        <RefreshButton />
      </div>
    </header>
  );
}
