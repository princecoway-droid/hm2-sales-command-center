import { HmCard } from "@/components/dashboard/hm-card";
import type { HmCardModel } from "@/lib/view-models/dashboard";

type HmPerformanceProps = {
  hms: readonly HmCardModel[];
  monthLabel: string;
};

/**
 * The team, in ranked order.
 *
 * The order is the Stage 3 ranking - Net units descending, ties broken
 * deterministically - and it arrives already sorted. Nothing here reorders,
 * and nothing here falls back to the order the database happened to return
 * rows in: a league table that reshuffles on refresh is a league table nobody
 * trusts.
 *
 * One column on a phone, two from `sm`, three from `xl`. The cards are a fixed
 * shape, so the grid stays aligned however many HMs there are.
 */
export function HmPerformance({ hms, monthLabel }: HmPerformanceProps) {
  return (
    <section aria-labelledby="hm-performance" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="hm-performance"
          className="text-xs font-semibold uppercase tracking-wider text-slate-500"
        >
          HM performance
        </h2>
        <p className="text-xs text-slate-400">
          {hms.length} {hms.length === 1 ? "HM" : "HMs"} · ranked by net units
        </p>
      </div>

      {hms.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No HMs are covered by {monthLabel}.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {hms.map((hm) => (
            <li key={hm.hmId}>
              <HmCard hm={hm} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
