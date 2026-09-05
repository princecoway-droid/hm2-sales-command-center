import { cn } from "@/lib/utils";
import type { KpiTile } from "@/lib/view-models/dashboard";

type KpiCardProps = {
  tile: KpiTile;
  /** Primary tiles carry the headline figures and are set a size larger. */
  emphasis?: "primary" | "secondary";
};

/**
 * One KPI.
 *
 * Layout only. Every string on it - including the em dash a blank figure reads
 * as - was decided by the presenter, so there is nothing here to get wrong
 * about what a number means.
 *
 * The number is the first thing the eye lands on: it is the largest thing in
 * the card, the only thing at full contrast, and the label above it is small
 * and grey. `tabular-nums` stops a row of cards twitching as figures change
 * width, and the sub-line is always rendered - blank if there is nothing to say
 * - so eight cards in a grid stay exactly the same height.
 */
export function KpiCard({ tile, emphasis = "secondary" }: KpiCardProps) {
  const subLabel = tile.unit ?? tile.note;

  return (
    // `min-w-0` matters: a grid item sizes to its content by default, so
    // without it a long figure pushes the card wider than its column instead of
    // the column deciding how much room the figure gets.
    <div className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <p className="truncate text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {tile.label}
      </p>

      <p
        className={cn(
          "mt-2 font-semibold tabular-nums leading-none text-slate-900",
          emphasis === "primary"
            ? "text-3xl lg:text-4xl"
            : "text-2xl lg:text-3xl",
        )}
      >
        {tile.value}
      </p>

      <p className="mt-2 text-xs leading-4 text-slate-400">
        {subLabel ?? " "}
      </p>
    </div>
  );
}
