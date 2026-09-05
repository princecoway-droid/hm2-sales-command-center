import {
  STATUS_BAR_CLASSES,
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
} from "@/components/ui/status-styles";
import { cn } from "@/lib/utils";
import type { PublicWeek } from "@/lib/view-models/public-share";
import type { PublicShareViewModel } from "@/lib/view-models/public-share";

type ShareWeeklyProps = {
  weekly: PublicShareViewModel["weekly"];
  monthLabel: string;
};

/**
 * Group Key-In, week by week, on a phone.
 *
 * A ROW rather than the dashboard's column chart. Six vertical bars in 375
 * pixels leaves each one about forty pixels wide with a three-digit number over
 * it, and the week ranges underneath stop fitting at all. Laid out as rows the
 * figure, the period and the band each get a full line's width, which is what
 * makes this readable one-handed - and it is the same data, the same order and
 * the same engine bands as the chart on the dashboard.
 *
 * Status is never colour alone: every row states its figure and names its band.
 * A blank week is an outlined track and an em dash - not a zero, and never red.
 */
export function ShareWeekly({ weekly, monthLabel }: ShareWeeklyProps) {
  return (
    <section
      aria-labelledby="share-weekly"
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-3">
        <h2
          id="share-weekly"
          className="text-sm font-semibold text-slate-900"
        >
          Weekly Key-In
        </h2>

        <p className="text-xs text-slate-500">
          <span className="font-semibold tabular-nums text-slate-900">
            {weekly.totalLabel}
          </span>{" "}
          units total
          {weekly.hasWeeks ? (
            <>
              {" · "}
              {weekly.weeksEntered} of {weekly.weeksConfigured} weeks entered
            </>
          ) : null}
        </p>
      </header>

      <div className="px-4 py-3">
        {!weekly.hasWeeks ? (
          <p className="py-4 text-center text-sm text-slate-500">
            No sales weeks are configured for {monthLabel} yet.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {weekly.weeks.map((week) => (
              <WeekRow key={week.key} week={week} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function WeekRow({ week }: { week: PublicWeek }) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-7 shrink-0 text-xs font-semibold text-slate-700">
        {week.label}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[11px] text-slate-500">
            {week.rangeLabel}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
            {week.unitsLabel}
          </span>
        </div>

        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          {week.isEntered ? (
            <div
              className={cn("h-2 rounded-full", STATUS_BAR_CLASSES[week.status])}
              // A real but tiny week still has to be visible, so the floor is
              // 4%. The figure beside it carries the actual value.
              style={{ width: `${Math.max(4, week.barPct)}%` }}
            />
          ) : (
            <div className="h-2 w-full rounded-full border border-dashed border-slate-200" />
          )}
        </div>
      </div>

      <span className="flex w-20 shrink-0 items-center justify-end gap-1.5 text-[11px] text-slate-500">
        <span
          aria-hidden
          className={cn("size-2 rounded-full", STATUS_DOT_CLASSES[week.status])}
        />
        {STATUS_LABELS[week.status]}
      </span>
    </li>
  );
}
