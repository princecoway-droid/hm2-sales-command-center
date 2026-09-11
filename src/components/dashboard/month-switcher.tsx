"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  findCurrentMonth,
  findMonthNeighbours,
  monthLabel,
  monthParam,
  sortMonthsAscending,
} from "@/lib/calendar";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Month } from "@/types/models";

type MonthSwitcherProps = {
  months: readonly Month[];
  selected: Month;
  /**
   * Where a month change navigates to. Defaults to the dashboard.
   *
   * The HM detail screen passes its own path so switching month there stays on
   * that HM instead of bouncing back to the group - same control, same URL
   * contract, one implementation.
   */
  basePath?: string;
};

/**
 * The reporting month the whole dashboard is scoped to.
 *
 * Switching month is a NAVIGATION, not local state. The URL carries
 * `?month=2026-09`, the server re-fetches everything for that month and the
 * page is rebuilt from it - so there is no path by which the KPI cards can
 * still be showing August while the chart shows September, and a browser
 * refresh lands on the same month it left.
 *
 * Previous and Next step through the months that actually EXIST rather than
 * doing calendar arithmetic: a month nobody has opened has nothing to show, so
 * the control is disabled instead of leading to an empty screen.
 *
 * Previous, Next and Today are real links - they work before hydration and
 * prefetch on hover. Only the dropdown needs JavaScript, and only to turn a
 * change event into the same navigation.
 */
export function MonthSwitcher({
  months,
  selected,
  basePath = ROUTES.dashboard,
}: MonthSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { previous, next } = findMonthNeighbours(months, selected.id);
  const current = findCurrentMonth(months);

  const options = sortMonthsAscending(months).reverse();

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        isPending && "opacity-70",
      )}
    >
      {/* One segmented control - arrow, month, arrow - rather than three
          separate chips. The hairline belongs to the group, and the dividers
          inside it are the same hairline, so it reads as a single object the
          way a native segmented control does. */}
      <div className="glass-chrome flex items-center overflow-hidden rounded-control shadow-[var(--shadow-control)] ring-1 ring-inset ring-slate-900/10">
        <StepLink month={previous} direction="previous" basePath={basePath} />

        <label htmlFor="dashboard-month" className="sr-only">
          Reporting month
        </label>
        <select
          id="dashboard-month"
          name="month"
          value={monthParam(selected)}
          onChange={(event) => {
            const value = event.target.value;

            if (value !== monthParam(selected)) {
              startTransition(() => {
                router.push(`${basePath}?month=${value}`);
              });
            }
          }}
          className={cn(
            // `min-h-11` is 44px - a comfortable touch target. The control is
            // the only way to change month on a phone, and at the 36px it used
            // to be, the two arrows either side of it were a 32px-wide miss
            // waiting to happen.
            "min-h-11 border-x hairline bg-transparent px-3 py-2 text-sm font-medium text-slate-900",
            "focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-sky-600",
          )}
        >
          {options.map((month) => (
            <option key={month.id} value={monthParam(month)}>
              {monthLabel(month)} · Q{month.quarter}
            </option>
          ))}
        </select>

        <StepLink month={next} direction="next" basePath={basePath} />
      </div>

      {current && current.id !== selected.id ? (
        <Link
          href={`${basePath}?month=${monthParam(current)}`}
          className={cn(
            "inline-flex min-h-11 items-center rounded-control px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-600/10",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600",
          )}
        >
          Today ({monthLabel(current)})
        </Link>
      ) : null}
    </div>
  );
}

function StepLink({
  month,
  direction,
  basePath,
}: {
  month: Month | null;
  direction: "previous" | "next";
  basePath: string;
}) {
  const arrow = direction === "previous" ? "←" : "→";
  const label =
    direction === "previous" ? "Previous month" : "Next month";

  // 44x44: the arrows are the fastest way to step a month on a phone, and an
  // arrow narrower than a fingertip is one that gets pressed twice.
  const shared =
    "flex min-h-11 min-w-11 items-center justify-center px-2.5 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600";

  if (!month) {
    return (
      <span
        aria-disabled
        title={`No ${direction === "previous" ? "earlier" : "later"} month has been opened`}
        className={cn(shared, "cursor-not-allowed text-slate-300")}
      >
        <span aria-hidden>{arrow}</span>
        <span className="sr-only">{label} (unavailable)</span>
      </span>
    );
  }

  return (
    <Link
      href={`${basePath}?month=${monthParam(month)}`}
      title={monthLabel(month)}
      className={cn(
        shared,
        "text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900",
      )}
    >
      <span aria-hidden>{arrow}</span>
      <span className="sr-only">
        {label}: {monthLabel(month)}
      </span>
    </Link>
  );
}
