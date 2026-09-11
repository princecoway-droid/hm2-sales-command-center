import { KpiStatusBadge } from "@/components/ui/kpi-status";
import {
  STATUS_BAR_CLASSES,
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
} from "@/components/ui/status-styles";
import {
  WEEKLY_KEYIN_GREEN_ABOVE,
  WEEKLY_KEYIN_YELLOW_FROM,
} from "@/lib/calculations";
import { cn } from "@/lib/utils";
import type { WeeklyBar, WeeklyChartModel } from "@/lib/view-models/dashboard";

type WeeklyKeyInProps = {
  weekly: WeeklyChartModel;
  monthLabel: string;
};

/**
 * Group Key-In, week by week.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a charting library
 * ---------------------------------------------------------------------------
 * Four to six bars, no zoom, no brush, no series toggling. Hand-drawn, it is a
 * flex row that renders on the server and ships no JavaScript at all; through a
 * charting library it is ~400 kB of client bundle, a hydration pass, and a
 * fight with per-bar `<Cell>` colouring to express a rule the engine has
 * already decided. The trade only goes one way at this size.
 *
 * The weeks are the Coway periods exactly as configured - four, five or six of
 * them, W1 routinely starting in the previous calendar month. Nothing here
 * derives a date or assumes a count.
 *
 * Status is the engine's, not the chart's, and it is never carried by colour
 * alone: every bar states its figure in text and its band as a dot WITH a
 * label. A blank week is an outlined track and an em dash - not a zero, and
 * never red, because the week has not happened yet.
 */
export function WeeklyKeyIn({ weekly, monthLabel }: WeeklyKeyInProps) {
  return (
    <section
      aria-labelledby="weekly-keyin"
      className="glass-panel"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b hairline px-4 py-3.5 sm:px-5">
        <h2 id="weekly-keyin" className="section-label">
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

      <div className="px-4 py-5 sm:px-5">
        {!weekly.hasWeeks ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No sales weeks are configured for {monthLabel}. Add the Coway
            periods in Data Entry to see the weekly breakdown.
          </p>
        ) : (
          <>
            <ol className="flex items-end gap-2 sm:gap-3.5">
              {weekly.weeks.map((week) => (
                <WeekColumn key={week.weekId} week={week} />
              ))}
            </ol>

            <Legend />
          </>
        )}
      </div>
    </section>
  );
}

function WeekColumn({ week }: { week: WeeklyBar }) {
  return (
    <li className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span className="figure-num text-sm font-semibold text-slate-900">
        {week.unitsLabel}
      </span>

      <div
        className="flex h-28 w-full items-end sm:h-36"
        title={`${week.label}: ${week.rangeLabel}`}
      >
        {week.isEntered ? (
          <div
            className={cn(
              // Rounded at the top only - the bar grows from a baseline, and a
              // pill would float off it.
              "w-full rounded-t-lg shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
              STATUS_BAR_CLASSES[week.status],
            )}
            // A real but tiny week still has to be visible as a bar, so the
            // floor is 4% rather than 0 - the figure above it carries the
            // actual value.
            style={{ height: `${Math.max(4, week.barPct)}%` }}
          />
        ) : (
          <div className="h-full w-full rounded-t-lg border border-dashed border-slate-900/[0.09] bg-slate-900/[0.02]" />
        )}
      </div>

      <span className="text-xs font-medium text-slate-700">{week.label}</span>

      <span className="hidden text-[10px] leading-tight text-slate-400 sm:block sm:text-center">
        {week.rangeLabel}
      </span>

      <span className="flex items-center gap-1 text-[10px] text-slate-500">
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", STATUS_DOT_CLASSES[week.status])}
        />
        <span className="hidden sm:inline">{STATUS_LABELS[week.status]}</span>
      </span>

      {/* The week's pacing band: the GROUP's Key-In for it against the GROUP's
          monthly target, at that week's threshold. A different question from
          the volume band above it - "was this a big week" against "is the month
          on pace at this point" - so both are shown rather than one replacing
          the other. The note is hidden on a phone, where five columns leave no
          room for a sentence; the screen-reader line below carries it. */}
      {/* A fixed minimum height, because the parent row aligns its columns by
          their bottom edge: a two-line "Needs Attention" in one column and a
          one-line "Watch" in the next would otherwise stagger the whole chart. */}
      <span className="flex min-h-8 w-full flex-col items-center gap-0.5 sm:min-h-10">
        {/* Ringed, so the two indicators in this column stay distinguishable on
            a phone where neither carries its word: the plain dot above is the
            week's volume band, this one is its pace against target. */}
        <KpiStatusBadge
          status={week.kpiStatus}
          compactOnMobile
          className="items-center text-center [&>span>span:first-child]:ring-1 [&>span>span:first-child]:ring-white [&>span>span:first-child]:ring-offset-1 [&>span>span:first-child]:ring-offset-slate-300"
        />

        <span className="hidden text-[10px] leading-tight text-slate-400 sm:block sm:text-center">
          {week.kpiStatus.note}
        </span>
      </span>

      {/* The whole week in one sentence, for a screen reader and for the
          small screens where the range and the band label are hidden. */}
      <span className="sr-only">
        {week.label}, {week.rangeLabel}:{" "}
        {week.isEntered
          ? `${week.unitsLabel} units, ${STATUS_LABELS[week.status]}, from ${week.hmsEntered} HM${week.hmsEntered === 1 ? "" : "s"}`
          : "not entered yet"}
        {week.kpiStatus.note ? `. ${week.kpiStatus.label}: ${week.kpiStatus.note}` : ""}
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
  const entries: { status: WeeklyBar["status"]; text: string }[] = [
    { status: "green", text: `Above ${WEEKLY_KEYIN_GREEN_ABOVE}` },
    {
      status: "yellow",
      text: `${WEEKLY_KEYIN_YELLOW_FROM} – ${WEEKLY_KEYIN_GREEN_ABOVE}`,
    },
    { status: "red", text: `Below ${WEEKLY_KEYIN_YELLOW_FROM}` },
    { status: "neutral", text: "Not entered" },
  ];

  return (
    <div className="mt-5 border-t hairline-inner pt-3.5">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <li className="font-medium text-slate-600">Weekly volume</li>
        {entries.map((entry) => (
          <li key={entry.status} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                STATUS_DOT_CLASSES[entry.status],
              )}
            />
            {entry.text}
          </li>
        ))}
      </ul>

      {/* Said in words rather than as a second row of dots. The two bands use
          the same three colours - deliberately, so red means one thing across
          the application - and the only way to tell them apart is to say what
          each is measuring. */}
      <p className="mt-1.5 text-[11px] text-slate-500">
        <span className="font-medium text-slate-600">Pacing</span> · Key-In{" "}
        <em className="not-italic font-medium text-slate-600">so far</em> — W1
        through that week, added up — as a share of the group&rsquo;s monthly
        target, at that week&rsquo;s threshold. No threshold is defined for W5
        or W6.
      </p>
    </div>
  );
}
