import { cn } from "@/lib/utils";
import type { MonthOverMonthModel } from "@/lib/view-models/dashboard";

type HmComparisonProps = {
  net: MonthOverMonthModel;
  recruitment: MonthOverMonthModel;
};

/**
 * This month against the one before it.
 *
 * Two comparisons, both produced by the same engine rule and formatted by the
 * same presenter as the dashboard's: Net, and recruitment.
 *
 * Neither will fill a gap with a number. No previous record says so outright
 * rather than showing a change from zero, and a previous month that really was
 * 0 keeps its unit difference but shows no percentage - there is no percentage
 * increase from nothing, and "+∞%" is not a figure.
 */
export function HmComparison({ net, recruitment }: HmComparisonProps) {
  return (
    <section
      aria-labelledby="hm-comparison"
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2
        id="hm-comparison"
        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        Previous month
      </h2>

      <ComparisonBlock label="Net" comparison={net} unit="units" />

      <div className="border-t border-slate-100 pt-3">
        <ComparisonBlock
          label="Recruitment"
          comparison={recruitment}
          unit="recruits"
        />
      </div>
    </section>
  );
}

function ComparisonBlock({
  label,
  comparison,
  unit,
}: {
  label: string;
  comparison: MonthOverMonthModel;
  unit: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>

      {comparison.hasPreviousMonth ? (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "text-2xl font-semibold tabular-nums leading-none",
                comparison.direction === "up"
                  ? "text-emerald-700"
                  : comparison.direction === "down"
                    ? "text-rose-700"
                    : "text-slate-900",
              )}
            >
              {comparison.changeUnitsLabel}
            </span>
            <span className="text-sm tabular-nums text-slate-500">
              {comparison.changePercentageLabel}
            </span>
          </p>

          <p className="mt-1 text-xs text-slate-500">
            {comparison.previousMonthLabel}:{" "}
            <span className="tabular-nums">{comparison.previousNetLabel}</span> →{" "}
            <span className="tabular-nums">{comparison.currentNetLabel}</span>{" "}
            {unit}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-500">
          Previous month data unavailable
        </p>
      )}
    </div>
  );
}
