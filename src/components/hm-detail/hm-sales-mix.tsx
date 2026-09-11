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
      className="glass-panel flex flex-col"
    >
      <header className="border-b hairline px-4 py-3.5 sm:px-5">
        <h2 id="hm-sales-mix" className="section-label">
          Sales mix
        </h2>
      </header>

      <div className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-5">
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

        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t hairline-inner pt-3.5 text-xs">
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
        <span className="figure-num text-sm text-slate-600">
          <span className="font-semibold text-slate-900">
            {entry.unitsLabel}
          </span>{" "}
          units · {entry.percentageLabel}
        </span>
      </div>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-900/[0.07]"
        role="img"
        aria-label={`${entry.label}: ${entry.unitsLabel} units, ${entry.percentageLabel} of total Key-In`}
      >
        <div
          className={cn(
            "h-full rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]",
            tone === "sky"
              ? "bg-gradient-to-r from-sky-600 to-sky-500"
              : "bg-gradient-to-r from-slate-400 to-slate-300",
          )}
          style={{ width: `${entry.barPct ?? 0}%` }}
        />
      </div>
    </div>
  );
}
