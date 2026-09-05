import Link from "next/link";
import type { ReactNode } from "react";

import { HmAvatar } from "@/components/hm/hm-avatar";
import { Badge } from "@/components/ui/badge";
import type { HmDetailViewModel } from "@/lib/view-models/hm-detail";

type HmDetailHeaderProps = {
  hm: HmDetailViewModel["hm"];
  month: HmDetailViewModel["month"];
  backHref: string;
  updatedLabel: string | null;
  /** The month switcher, so the screen can be moved through the year. */
  controls?: ReactNode;
};

/**
 * Who this screen is about, and which month it is showing.
 *
 * Back comes first, above everything, because on a phone it is the control most
 * likely to be wanted and the one hardest to reach if it is tucked beside a
 * title. It is a real link carrying `?month=`, so it returns the manager to the
 * month they came from rather than to today's.
 *
 * The name is a heading and wraps rather than truncates: a detail screen is a
 * person's identity, and "Sample HM…" with the distinguishing part cut off is
 * worse than a name on two lines. The office wraps under it for the same
 * reason.
 *
 * The month is stated as plainly as the name, because every figure below
 * depends on it - and this screen legitimately shows a month other than today's.
 */
export function HmDetailHeader({
  hm,
  month,
  backHref,
  updatedLabel,
  controls,
}: HmDetailHeaderProps) {
  return (
    <header className="space-y-4 border-b border-slate-200 pb-4">
      <Link
        href={backHref}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        <span aria-hidden>←</span>
        Back to HM2 Dashboard
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3 sm:gap-4">
          {/* The same avatar as the dashboard card, so a missing photo falls
              back to initials at the same footprint. Its `alt` is empty by
              design: the name is right beside it. */}
          <HmAvatar name={hm.name} photoUrl={hm.photoUrl} size="lg" />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight break-words text-slate-900 sm:text-3xl">
                {hm.name}
              </h1>

              {!hm.isActive ? <Badge tone="muted">Inactive</Badge> : null}

              {hm.rankLabel ? (
                <Badge tone="neutral">{hm.rankLabel}</Badge>
              ) : null}
            </div>

            <p className="mt-1 text-sm break-words text-slate-500">
              {hm.office}
            </p>

            <p className="mt-2 text-sm font-medium text-slate-900">
              {month.label}
              <span className="ml-2 text-xs font-normal text-slate-400">
                {month.quarterLabel}
              </span>
            </p>

            <p className="mt-1 text-xs text-slate-500">
              {updatedLabel ? (
                <>Updated {updatedLabel} (MYT)</>
              ) : (
                <>No figures recorded for this month yet</>
              )}
            </p>
          </div>
        </div>

        {controls ? (
          <div className="flex flex-wrap items-center gap-2">{controls}</div>
        ) : null}
      </div>
    </header>
  );
}
