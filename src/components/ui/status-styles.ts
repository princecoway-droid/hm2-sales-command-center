import type { KpiStatus } from "@/lib/calculations/kpi-status";
import type { PerformanceStatus } from "@/lib/calculations/performance";

/**
 * The one place performance status turns into colour.
 *
 * Deliberately low-contrast fills. A grid of fifty rows tinted in saturated
 * red and green is unreadable, and worse, it flattens the difference between
 * "below target" and "urgent" - everything shouts equally. These tints sit
 * behind the number without competing with it, and the text colour does most
 * of the work.
 *
 * `neutral` is the blank state, not a fourth band: nothing has been entered, so
 * nothing is coloured.
 */
export const STATUS_CELL_CLASSES: Record<PerformanceStatus, string> = {
  green: "bg-emerald-500/[0.09] text-emerald-900",
  yellow: "bg-amber-400/[0.14] text-amber-900",
  red: "bg-rose-500/[0.09] text-rose-900",
  neutral: "text-slate-900",
};

/** Small dot for legends and compact readouts. */
export const STATUS_DOT_CLASSES: Record<PerformanceStatus, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-rose-500",
  neutral: "bg-slate-300",
};

/**
 * Solid fills, for a bar that has to read at a glance from across a desk.
 *
 * Stronger than the cell tints because a chart bar IS the figure - there is no
 * number sitting on top of it doing the work - and weaker than the pure hues
 * so five bars in a row still look like one chart. `neutral` is a blank week:
 * an outline, not a fill, because there is nothing to show the size of.
 *
 * A one-stop gradient, lighter at the top, so a tall bar has some form to it
 * rather than reading as a flat block of colour. It is the same hue throughout
 * - the gradient is shading, not a second signal.
 */
export const STATUS_BAR_CLASSES: Record<PerformanceStatus, string> = {
  green: "bg-gradient-to-t from-emerald-500 to-emerald-400",
  yellow: "bg-gradient-to-t from-amber-500 to-amber-400",
  red: "bg-gradient-to-t from-rose-500 to-rose-400",
  neutral: "bg-slate-200",
};

/** Text colour that stays legible on white at small sizes. */
export const STATUS_TEXT_CLASSES: Record<PerformanceStatus, string> = {
  green: "text-emerald-700",
  yellow: "text-amber-700",
  red: "text-rose-700",
  neutral: "text-slate-400",
};

export const STATUS_LABELS: Record<PerformanceStatus, string> = {
  green: "On track",
  yellow: "Watch",
  red: "Below",
  neutral: "Not entered",
};

// -----------------------------------------------------------------------------
// KPI status (Stage 9)
// -----------------------------------------------------------------------------

/**
 * The Stage 9 bands in colour.
 *
 * The same three hues the rest of the application already uses, so a red dot
 * means the same thing wherever it appears - a manager should not have to learn
 * two palettes.
 *
 * Colour is never the only channel: every badge that uses these also renders
 * the band in words. A dot alone would be invisible to a colour-blind reader
 * and silent to a screen reader, and these bands are the business's own
 * thresholds rather than decoration.
 */
export const KPI_STATUS_DOT_CLASSES: Record<KpiStatus, string> = {
  needs_attention: "bg-rose-500",
  watch: "bg-amber-500",
  on_track: "bg-emerald-500",
};

export const KPI_STATUS_TEXT_CLASSES: Record<KpiStatus, string> = {
  needs_attention: "text-rose-700",
  watch: "text-amber-700",
  on_track: "text-emerald-700",
};

/** Tinted pill, for the places a band has to be findable rather than merely legible. */
export const KPI_STATUS_PILL_CLASSES: Record<KpiStatus, string> = {
  needs_attention: "bg-rose-500/[0.09] text-rose-800 ring-rose-600/20",
  watch: "bg-amber-400/[0.14] text-amber-900 ring-amber-600/25",
  on_track: "bg-emerald-500/[0.09] text-emerald-800 ring-emerald-600/20",
};

/** The "no band" appearance. Not a fourth band - nothing has been stated. */
export const KPI_STATUS_NONE_CLASSES = {
  dot: "bg-slate-300",
  text: "text-slate-400",
  pill: "bg-slate-900/[0.04] text-slate-500 ring-slate-900/10",
} as const;
