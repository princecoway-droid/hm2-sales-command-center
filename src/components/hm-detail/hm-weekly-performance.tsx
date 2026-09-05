import {
  STATUS_BAR_CLASSES,
  STATUS_DOT_CLASSES,
} from "@/components/ui/status-styles";
import {
  WEEKLY_KEYIN_GREEN_ABOVE,
  WEEKLY_KEYIN_YELLOW_FROM,
} from "@/lib/calculations";
import { cn } from "@/lib/utils";
import type {
  HmWeeklyBarModel,
  HmWeeklyModel,
} from "@/lib/view-models/hm-detail";

type HmWeeklyPerformanceProps = {
  weekly: HmWeeklyModel;
  monthLabel: string;
};

/**
 * This HM's Key-In, week by week.
 *
 * ---------------------------------------------------------------------------
 * Why the bars run across rather than up
 * ---------------------------------------------------------------------------
 * The dashboard's group chart is a column per week, which works because it sits
 * in a wide panel. Here the same six columns have to survive a 375px screen,
 * and at that width a vertical chart gives each week about 50px - enough for
 * the bar, and nothing for "30 Aug – 5 Sep". Turned on its side every week gets
 * the full width of the card for its dates and its figure, and the layout is
 * the same from a phone to a 1440px desktop instead of two designs to keep in
 * step.
 *
 * Still no charting library: a handful of bars is a flex row that renders on
 * the server and ships no JavaScript, against ~400 kB of client bundle and a
 * hydration pass to express a rule the engine has already decided.
 *
 * The weeks are the Coway periods exactly as configured - four, five or six of
 * them, W1 routinely starting in the previous calendar month. Nothing here
 * derives a date or assumes a count.
 *
 * Status is the engine's, and never carried by colour alone: every row states
 * its figure and its band in words. A blank week is an outlined track and an em
 * dash - not a zero, and never red, because the week has not happened yet.
 */
export function HmWeeklyPerformance({
  weekly,
  monthLabel,
}: HmWeeklyPerformanceProps) {
  return (
    <section
      aria-labelledby="hm-weekly"
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-3">
        <h2
          id="hm-weekly"
          className="text-xs font-semibold uppercase tracking-wider text-slate-500"
        >
          Weekly Key-In
        </h2>

        <p className="text-xs text-slate-500">
          <span className="font-semibold tabular-nums text-slate-900">
            {weekly.totalLabel}
          </span>{" "}
          units total
          {weekly.hasWeeks ? <> · {weekly.entriesLabel}</> : null}
        </p>
      </header>

      <div className="px-4 py-4">
        {!weekly.hasWeeks ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No sales weeks are configured for {monthLabel}. Add the Coway
            periods in Data Entry to see the weekly breakdown.
          </p>
        ) : (
          <>
            <ol className="space-y-2.5">
              {weekly.weeks.map((week) => (
                <WeekRow key={week.weekId} week={week} />
              ))}
            </ol>

            <Legend />
          </>
        )}
      </div>
    </section>
  );
}

function WeekRow({ week }: { week: HmWeeklyBarModel }) {
  return (
    <li className="grid grid-cols-[2.25rem_1fr_3.5rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[2.5rem_7.5rem_1fr_4rem]">
      <span className="text-sm font-semibold text-slate-700">{week.label}</span>

      {/* The official period. Hidden on the narrowest screens only in the sense
          that it moves to its own line under the bar, never dropped: a Coway
          week is not a calendar week, so the dates are the only way to know
          which days a figure covers. */}
      <span className="col-start-2 row-start-2 text-[11px] leading-tight text-slate-400 sm:col-start-2 sm:row-start-1">
        {week.rangeLabel}
      </span>

      <div className="col-start-2 row-start-1 flex h-6 items-center sm:col-start-3">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          {week.isEntered ? (
            <div
              className={cn("h-full rounded-full", STATUS_BAR_CLASSES[week.status])}
              // A real but tiny week still has to be visible as a bar, so the
              // floor is 4% rather than 0 - the figure beside it carries the
              // actual value.
              style={{ width: `${Math.max(4, week.barPct)}%` }}
            />
          ) : (
            <div className="h-full w-full rounded-full border border-dashed border-slate-200 bg-slate-50" />
          )}
        </div>
      </div>

      <span className="col-start-3 row-start-1 flex items-center justify-end gap-1.5 text-sm font-semibold tabular-nums text-slate-900 sm:col-start-4">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", STATUS_DOT_CLASSES[week.status])}
        />
        {week.unitsLabel}
      </span>

      {/* The whole week in one sentence, for a screen reader and for anyone
          reading the band rather than the colour. */}
      <span className="sr-only">
        {week.label}, {week.rangeLabel}:{" "}
        {week.isEntered
          ? `${week.unitsLabel} units, ${week.statusLabel}`
          : "not entered yet, NEUTRAL"}
      </span>
    </li>
  );
}

/**
 * The locked bands, spelled out.
 *
 * The numbers come from the engine's own constants rather than being typed out
 * again, so a legend saying "above 15" cannot survive a threshold changing
 * underneath it. The bands themselves are still decided in one place; this only
 * reads them.
 */
function Legend() {
  const entries: { status: HmWeeklyBarModel["status"]; text: string }[] = [
    { status: "green", text: `Above ${WEEKLY_KEYIN_GREEN_ABOVE}` },
    {
      status: "yellow",
      text: `${WEEKLY_KEYIN_YELLOW_FROM} – ${WEEKLY_KEYIN_GREEN_ABOVE}`,
    },
    { status: "red", text: `Below ${WEEKLY_KEYIN_YELLOW_FROM}` },
    { status: "neutral", text: "Not entered" },
  ];

  return (
    <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
      {entries.map((entry) => (
        <li key={entry.status} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-2 rounded-full", STATUS_DOT_CLASSES[entry.status])}
          />
          {entry.text}
        </li>
      ))}
    </ul>
  );
}
