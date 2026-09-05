import { cn } from "@/lib/utils";
import type {
  HmSalesMixEntryModel,
  HmSalesMixModel,
} from "@/lib/view-models/hm-detail";

type HmSalesMixProps = {
  salesMix: HmSalesMixModel;
};

/**
 * The month's Extrade and Non-Extrade figures, each as a share of Key-In.
 *
 * Both percentages come off TOTAL KEY-IN, calculated once in the engine.
 * Nothing here divides anything - which matters more on this card than anywhere
 * else, because the two unit figures and the Net are all on the same screen and
 * the temptation to work the share out inline against Net is exactly what this
 * stage forbids.
 *
 * The two figures are independent manual inputs: they are not required to add
 * up to Net, to Key-In, or to each other, so the balance line below is a stated
 * difference and not a warning about a broken record.
 */
export function HmSalesMix({ salesMix }: HmSalesMixProps) {
  return (
    <section
      aria-labelledby="hm-sales-mix"
      className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <header className="border-b border-slate-200 px-4 py-3">
        <h2
          id="hm-sales-mix"
          className="text-xs font-semibold uppercase tracking-wider text-slate-500"
        >
          Sales mix
        </h2>
      </header>

      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        {salesMix.hasSplit ? (
          <>
            <MixRow entry={salesMix.extrade} tone="sky" />
            <MixRow entry={salesMix.nonExtrade} tone="slate" />
          </>
        ) : (
          <p className="text-sm text-slate-500">
            The Extrade split has not been entered for this month.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-slate-100 pt-3 text-xs">
          <span className="text-slate-500">Split balance:</span>
          {/* Slate, not amber, when the two do not meet: a split that does not
              come to the Key-In total is an ordinary state, not a fault. */}
          <span
            className={cn(
              "font-semibold tabular-nums",
              salesMix.isBalanced ? "text-emerald-700" : "text-slate-700",
            )}
          >
            {salesMix.balanceLabel}
          </span>
          <span className="text-slate-400">{salesMix.balanceNote}</span>
        </div>
      </div>
    </section>
  );
}

function MixRow({
  entry,
  tone,
}: {
  entry: HmSalesMixEntryModel;
  tone: "sky" | "slate";
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium text-slate-700">{entry.label}</span>
        <span className="text-sm tabular-nums text-slate-600">
          <span className="font-semibold text-slate-900">
            {entry.unitsLabel}
          </span>{" "}
          units · {entry.percentageLabel}
        </span>
      </div>

      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`${entry.label}: ${entry.unitsLabel} units, ${entry.percentageLabel} of total Key-In`}
      >
        <div
          className={cn(
            "h-full rounded-full",
            tone === "sky" ? "bg-sky-600" : "bg-slate-400",
          )}
          style={{ width: `${entry.barPct ?? 0}%` }}
        />
      </div>
    </div>
  );
}
