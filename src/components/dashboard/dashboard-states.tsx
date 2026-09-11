import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";

/**
 * The states a dashboard has to be honest about.
 *
 * All three exist to avoid the same failure: a screen full of zeros that looks
 * like a finished month. A month nobody has keyed in has not gone badly, and a
 * reporting month nobody has opened is not a month of no sales.
 */

type EmptyStateProps = {
  monthLabel: string;
  /** Deep-links straight to this month in Data Entry. */
  monthId: string;
  canEnterData: boolean;
};

/** The month exists; nothing has been entered against it. */
export function DashboardEmptyState({
  monthLabel,
  monthId,
  canEnterData,
}: EmptyStateProps) {
  return (
    <div className="rounded-card border border-dashed border-slate-900/12 bg-white/55 px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-slate-900">
        Nothing entered for {monthLabel} yet
      </h2>

      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        No HM performance data has been recorded for this month. The KPI cards,
        the weekly chart and the HM ranking appear as soon as the first figures
        are saved.
      </p>

      {canEnterData ? (
        <Link
          href={`${ROUTES.dataEntry}?month=${monthId}`}
          className="mt-5 inline-block"
        >
          <Button>Go to Data Entry</Button>
        </Link>
      ) : (
        <p className="mt-5 text-sm text-slate-500">
          Ask the PA to key in this month&apos;s figures.
        </p>
      )}
    </div>
  );
}

type NoMonthsProps = {
  /** Today's month, as it would be labelled once opened. */
  currentMonthLabel: string;
  canEnterData: boolean;
};

/** No reporting month exists at all - the first-run and turn-of-year case. */
export function NoReportingMonthsState({
  currentMonthLabel,
  canEnterData,
}: NoMonthsProps) {
  return (
    <div className="rounded-card border border-dashed border-slate-900/12 bg-white/55 px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-slate-900">
        Current reporting month is not configured
      </h2>

      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        {currentMonthLabel} has not been opened, and there is no earlier month
        to fall back to. A reporting month has to exist before any figures can
        be recorded against it.
      </p>

      {canEnterData ? (
        <Link href={ROUTES.dataEntry} className="mt-5 inline-block">
          <Button>Open a reporting month</Button>
        </Link>
      ) : (
        <p className="mt-5 text-sm text-slate-500">
          Ask your manager or the PA to open {currentMonthLabel}.
        </p>
      )}
    </div>
  );
}
