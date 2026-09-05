import { HmMetric } from "@/components/hm-detail/hm-metric";
import type { HmMetricModel } from "@/lib/view-models/hm-detail";

type HmSecondaryKpisProps = {
  metrics: readonly HmMetricModel[];
};

/**
 * Recruitment, Active HP and SHI.
 *
 * The three figures that are keyed in rather than derived - recruitment from
 * the month's own count, Active HP and SHI straight from eTrust. None of them
 * is calculated from sales, and none of them is substituted when missing: a
 * blank SHI says "Not entered" rather than borrowing the group's or last
 * month's.
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
        Recruitment and eTrust
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <HmMetric key={metric.key} metric={metric} />
        ))}
      </div>
    </section>
  );
}
