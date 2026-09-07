import { HmMetric } from "@/components/hm-detail/hm-metric";
import type { HmMetricModel } from "@/lib/view-models/hm-detail";

type HmSecondaryKpisProps = {
  metrics: readonly HmMetricModel[];
};

/**
 * Recruitment, Active HP and SHI.
 *
 * Recruitment and SHI are keyed in; Active HP is COUNTED from the HP rows the
 * PA imported for the month, and its tile opens that list filtered to this HM.
 * None of the three is calculated from sales, and none is substituted when
 * missing: a blank SHI says "Not entered" rather than borrowing the group's or
 * last month's, and a blank Active HP says no HP file has been imported rather
 * than reporting zero.
 *
 * Two columns on a phone and three from `sm`. Three 11px tiles across a 375px
 * screen would put "RECRUITMENT" on two lines and leave the figures the same
 * size as their labels.
 */
export function HmSecondaryKpis({ metrics }: HmSecondaryKpisProps) {
  return (
    <section aria-labelledby="hm-secondary" className="space-y-3">
      <h2
        id="hm-secondary"
        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        Recruitment, Active HP and SHI
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <HmMetric key={metric.key} metric={metric} />
        ))}
      </div>
    </section>
  );
}
