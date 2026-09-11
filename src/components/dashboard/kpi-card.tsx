import Link from "next/link";

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
 *
 * A tile carrying an `href` becomes a link over the whole card. Today that is
 * Active HP alone: it is a COUNT of rows somebody can go and read, and "96
 * active" invites "which 96". Every other figure on this row is a total or a
 * percentage with nothing behind it to open, so linking them would promise a
 * page that does not exist.
 */
export function KpiCard({ tile, emphasis = "secondary" }: KpiCardProps) {
  const subLabel = tile.unit ?? tile.note;

  const body = (
    <>
      <p className="section-label truncate">{tile.label}</p>

      <p
        className={cn(
          "figure-num mt-2.5 font-semibold leading-none text-slate-900",
          emphasis === "primary"
            ? "text-[1.75rem] sm:text-3xl lg:text-4xl"
            : "text-2xl lg:text-3xl",
        )}
      >
        {tile.value}
      </p>

      <p className="mt-2.5 text-xs leading-4 text-slate-400">
        {subLabel ?? " "}
      </p>
    </>
  );

  // `min-w-0` matters on both branches: a grid item sizes to its content by
  // default, so without it a long figure pushes the card wider than its column
  // instead of the column deciding how much room the figure gets.
  const shell = "glass-card flex min-w-0 flex-col px-4 py-4 sm:px-5";

  if (!tile.href) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={tile.href}
      // The label and the figure together, so a screen reader announces
      // "Active HP, 96 - open the HP list" rather than a bare number.
      aria-label={`${tile.label}, ${tile.value} - open the HP list`}
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
