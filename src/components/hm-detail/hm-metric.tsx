import Link from "next/link";

import { KpiStatusBadge } from "@/components/ui/kpi-status";
import {
  STATUS_DOT_CLASSES,
  STATUS_TEXT_CLASSES,
} from "@/components/ui/status-styles";
import { cn } from "@/lib/utils";
import type { HmMetricModel } from "@/lib/view-models/hm-detail";

type HmMetricProps = {
  metric: HmMetricModel;
  /** `hero` is the one figure the screen is about; `lead` supports it. */
  emphasis?: "hero" | "lead" | "normal";
};

const VALUE_SIZES = {
  hero: "text-[2.5rem] leading-none sm:text-5xl",
  lead: "text-2xl sm:text-3xl",
  normal: "text-2xl",
} as const;

/**
 * One figure on the HM's screen.
 *
 * Layout only. Every string on it - including the em dash a blank figure reads
 * as, and the word for a status band - was decided by the presenter, so there
 * is nothing here to get wrong about what a number means.
 *
 * The band is shown as a dot AND the word beside it. Colour alone would leave
 * the whole signal on the one channel a colour-blind reader and a screen reader
 * both lose, and this screen's bands are the business's own thresholds rather
 * than decoration.
 *
 * The note line is always rendered - blank when there is nothing to say - so a
 * row of these keeps one height and the grid does not step as figures arrive.
 *
 * A metric that carries an `href` becomes a link over the whole tile: today
 * that is Active HP, which is a COUNT of rows the manager can go and read. The
 * link wraps the tile rather than the number so the touch target is the tile,
 * and its accessible name is the label and the value together - "Active HP, 18"
 * - rather than a bare number.
 */
export function HmMetric({ metric, emphasis = "normal" }: HmMetricProps) {
  const kpiStatus = metric.kpiStatus ?? null;

  // Only one band per tile. Recruitment carries both - the Stage 2 colour band
  // and the Stage 9 pacing band - and they disagree by design: 3 recruits is
  // GREEN under the old thresholds and Watch under the new ones. Showing both
  // would put two contradictory verdicts on one figure, so the Stage 9 band
  // wins wherever it exists, and the older one still drives the data-entry
  // grid, the WhatsApp report and the shared report untouched.
  const showStatus =
    kpiStatus === null && metric.status !== null && metric.status !== "neutral";

  const body = (
    <>
      <p className="section-label truncate">{metric.label}</p>

      <p
        className={cn(
          "figure-num mt-2.5 font-semibold leading-none text-slate-900",
          VALUE_SIZES[emphasis],
        )}
      >
        {metric.value}
        {metric.unit ? (
          <span className="ml-1.5 align-baseline text-sm font-normal text-slate-400">
            {metric.unit}
          </span>
        ) : null}
      </p>

      {/* The Stage 9 band, with the arithmetic behind it. On Key-In that line
          is doing real work: the figure above is the month's total, while the
          band is the CURRENT week against the monthly target - two different
          numbers, and the note is what keeps them from being read as one. */}
      {kpiStatus ? (
        <KpiStatusBadge status={kpiStatus} showNote className="mt-2" />
      ) : null}

      {/* Wraps rather than truncates. At 375px "Sum of entered weeks" and
          "GREEN · New this month" both run past the tile, and a note clipped to
          "Sum of entered wee…" has lost the word that made it a sentence. The
          grid stretches its items, so a two-line note keeps the row aligned. */}
      <p className="mt-2 flex min-h-4 flex-wrap items-center gap-x-1.5 text-xs leading-4 text-slate-400">
        {showStatus && metric.status ? (
          <>
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                STATUS_DOT_CLASSES[metric.status],
              )}
            />
            <span
              className={cn("font-medium", STATUS_TEXT_CLASSES[metric.status])}
            >
              {metric.statusLabel}
            </span>
            {/* No separator character: the flex gap does that job, and a "·"
                stranded at the start of a wrapped line reads as a typo. */}
            {metric.note ? <span>{metric.note}</span> : null}
          </>
        ) : (
          <span>{metric.note ?? " "}</span>
        )}
      </p>
    </>
  );

  // `min-w-0` matters on both branches: a grid item sizes to its content by
  // default, so without it a long figure pushes the tile wider than its column.
  const shell = "glass-card flex min-w-0 flex-col px-4 py-4 sm:px-5";

  if (!metric.href) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={metric.href}
      aria-label={`${metric.label}, ${metric.value} - open the HP list`}
      className={cn(
        shell,
        "glass-interactive",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600",
      )}
    >
      {body}
    </Link>
  );
}
