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
  hero: "text-4xl sm:text-5xl",
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
 */
export function HmMetric({ metric, emphasis = "normal" }: HmMetricProps) {
  const showStatus = metric.status !== null && metric.status !== "neutral";

  return (
    // `min-w-0` matters: a grid item sizes to its content by default, so
    // without it a long figure pushes the tile wider than its column.
    <div className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <p className="truncate text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {metric.label}
      </p>

      <p
        className={cn(
          "mt-2 font-semibold tabular-nums leading-none text-slate-900",
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
    </div>
  );
}
