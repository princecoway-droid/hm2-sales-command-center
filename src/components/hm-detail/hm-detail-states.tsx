import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The states an HM screen has to be honest about.
 *
 * Both exist to avoid the same failure in different directions: a page of
 * zeros that reads as a finished month, and a stack trace where a plain "that
 * HM does not exist" belongs.
 */

type HmNotFoundProps = {
  backHref: string;
};

/** The id in the URL matches no HM. A stale bookmark, or a deleted record. */
export function HmNotFoundState({ backHref }: HmNotFoundProps) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <h1 className="text-base font-semibold text-slate-900">HM not found</h1>

      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        No Health Manager matches this link. They may have been removed, or the
        link may be out of date.
      </p>

      <Link href={backHref} className="mt-5 inline-block">
        <Button>Back to HM2 Dashboard</Button>
      </Link>
    </div>
  );
}

type NoDataProps = {
  message: string;
  monthLabel: string;
  /** Deep-links straight to this month in Data Entry. */
  dataEntryHref: string | null;
};

/**
 * The HM exists; the month holds nothing for them.
 *
 * Shown as a banner ABOVE the figures rather than instead of them. The KPI
 * sections still render, every one of them blank, so the shape of the screen is
 * the same as always and it is obvious that the figures are missing rather than
 * that the page is broken.
 */
export function HmNoDataState({ message, monthLabel, dataEntryHref }: NoDataProps) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-4 text-sm"
    >
      <p className="font-semibold text-slate-900">{message}</p>

      <p className="mt-1 text-slate-500">
        Nothing has been keyed in for {monthLabel}, so every figure below is
        shown as blank rather than as zero.
      </p>

      {dataEntryHref ? (
        <Link href={dataEntryHref} className="mt-3 inline-block">
          <Button variant="secondary">Go to Data Entry</Button>
        </Link>
      ) : null}
    </div>
  );
}
