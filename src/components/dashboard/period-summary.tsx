import { cn } from "@/lib/utils";
import type {
  MonthOverMonthModel,
  QtdModel,
} from "@/lib/view-models/dashboard";

type PeriodSummaryProps = {
  monthOverMonth: MonthOverMonthModel;
  qtd: QtdModel;
};

/**
 * The month in context: against last month, and across the quarter.
 *
 * Secondary by design. It sits beside the weekly chart rather than above the
 * KPI cards, is set smaller, and carries no colour of its own - the question a
 * command centre answers first is "how is this month going", and this is the
 * follow-up.
 *
 * Both halves refuse to fill a gap with a number. No previous month says so
 * outright; a quarter missing a month names the month rather than quietly
 * summing what is there and calling it the quarter.
 */
export function PeriodSummary({ monthOverMonth, qtd }: PeriodSummaryProps) {
  return (
    <section
      aria-labelledby="period-summary"
      className="glass-panel flex flex-col gap-4 p-4 sm:p-5"
    >
      <h2 id="period-summary" className="section-label">
        In context
      </h2>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Net vs previous month
        </p>

        {monthOverMonth.hasPreviousMonth ? (
          <>
            <p className="mt-1 flex items-baseline gap-2">
              <span
                className={cn(
                  "figure-num text-2xl font-semibold leading-none",
                  monthOverMonth.direction === "up"
                    ? "text-emerald-700"
                    : monthOverMonth.direction === "down"
                      ? "text-rose-700"
                      : "text-slate-900",
                )}
              >
                {monthOverMonth.changeUnitsLabel}
              </span>
              <span className="text-sm tabular-nums text-slate-500">
                {monthOverMonth.changePercentageLabel}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {monthOverMonth.previousMonthLabel}:{" "}
              <span className="tabular-nums">
                {monthOverMonth.previousNetLabel}
              </span>{" "}
              → <span className="tabular-nums">
                {monthOverMonth.currentNetLabel}
              </span>{" "}
              units
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            {monthOverMonth.emptyMessage}
          </p>
        )}
      </div>

      <div className="border-t hairline-inner pt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {qtd.quarterLabel} to date
        </p>

        <dl className="mt-1 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-slate-500">Net</dt>
            <dd className="figure-num text-xl font-semibold leading-tight text-slate-900">
              {qtd.netLabel}
              <span className="ml-1 text-xs font-normal text-slate-400">
                units
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Recruitment</dt>
            <dd className="figure-num text-xl font-semibold leading-tight text-slate-900">
              {qtd.recruitmentLabel}
            </dd>
          </div>
        </dl>

        <p className="mt-2 text-xs text-slate-500">
          {qtd.monthsLabel}
          {qtd.incompleteMessage ? (
            <span className="text-amber-700"> · {qtd.incompleteMessage}</span>
          ) : null}
        </p>
      </div>
    </section>
  );
}
