import {
  KPI_STATUS_DOT_CLASSES,
  KPI_STATUS_NONE_CLASSES,
  KPI_STATUS_PILL_CLASSES,
  KPI_STATUS_TEXT_CLASSES,
} from "@/components/ui/status-styles";
import { cn } from "@/lib/utils";
import type { KpiStatusModel } from "@/lib/view-models/dashboard";

type KpiStatusBadgeProps = {
  status: KpiStatusModel;
  /**
   * `inline` is a dot and a word under a figure - the dashboard card and the
   * weekly rows. `pill` is a tinted chip for the places a band has to be
   * findable in a page rather than merely readable beside its number.
   */
  variant?: "inline" | "pill";
  /** The arithmetic line under the band. Off where the space is not there. */
  showNote?: boolean;
  /**
   * Drop to the dot alone below `sm`, keeping the word for a screen reader.
   *
   * For the one place the words genuinely do not fit: five columns of a bar
   * chart across a 375px screen, where "Needs Attention" wraps to two lines in
   * one column and one line in the next and the row stops lining up. Everywhere
   * else the word is shown, because a dot on its own is not a label.
   */
  compactOnMobile?: boolean;
  className?: string;
};

/**
 * One KPI's pacing band.
 *
 * ---------------------------------------------------------------------------
 * Layout only
 * ---------------------------------------------------------------------------
 * Every string on it - the band's words, the note explaining what was measured
 * against what - was decided by the presenter, which read the band from the
 * engine. There is no threshold in this file, and no component may put one
 * here: a badge that decided "below 60 is red" would be a second definition of
 * a business rule that already has exactly one.
 *
 * The band is a dot AND the word beside it, always. Colour alone would put the
 * whole signal on the one channel a colour-blind reader and a screen reader
 * both lose - and these are the business's own thresholds, not decoration.
 *
 * A `null` status is not a fourth band. It is "nothing can be stated", and the
 * label says which kind of nothing - "Not entered", "Not configured" for a week
 * with no defined threshold, "No target". It is rendered in slate, never in
 * red: an HM nobody has keyed in has not had a bad month.
 */
export function KpiStatusBadge({
  status,
  variant = "inline",
  showNote = false,
  compactOnMobile = false,
  className,
}: KpiStatusBadgeProps) {
  const dot = status.status
    ? KPI_STATUS_DOT_CLASSES[status.status]
    : KPI_STATUS_NONE_CLASSES.dot;

  if (variant === "pill") {
    const pill = status.status
      ? KPI_STATUS_PILL_CLASSES[status.status]
      : KPI_STATUS_NONE_CLASSES.pill;

    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
          pill,
          className,
        )}
      >
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        {status.label}
      </span>
    );
  }

  const text = status.status
    ? KPI_STATUS_TEXT_CLASSES[status.status]
    : KPI_STATUS_NONE_CLASSES.text;

  return (
    <span className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", dot)}
        />
        {/* Wraps rather than truncates: "Needs Attention" clipped to "Needs
            Atten…" is the one label on this screen that must not be guessed
            at. The card rows stretch, so a second line keeps the grid aligned. */}
        <span
          className={cn(
            "text-[11px] font-medium leading-tight",
            text,
            compactOnMobile ? "hidden sm:inline" : undefined,
          )}
        >
          {status.label}
        </span>

        {/* The word survives even where it is not drawn: a dot is not a label. */}
        {compactOnMobile ? (
          <span className="sr-only sm:hidden">{status.label}</span>
        ) : null}
      </span>

      {showNote && status.note ? (
        <span className="text-[10px] leading-tight text-slate-400">
          {status.note}
        </span>
      ) : null}
    </span>
  );
}
