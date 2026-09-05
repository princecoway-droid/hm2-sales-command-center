import { TargetProgress } from "@/components/dashboard/target-progress";
import { HmMetric } from "@/components/hm-detail/hm-metric";
import type { HmDetailViewModel } from "@/lib/view-models/hm-detail";

type HmPrimaryPerformanceProps = {
  detail: HmDetailViewModel;
};

/**
 * The month in one glance: Net, against target, out of what was keyed in.
 *
 * Net is the largest thing on the screen and stands alone in its own row -
 * "how is this HM doing this month" is the question the page exists to answer,
 * and everything under it is context for that one figure.
 *
 * Target and Achievement sit beside each other because they are one statement,
 * and the track underneath says it a second way. The track carries no
 * achievement bands: the business has not defined any, so inventing a
 * red-below-80 rule here would put a decision nobody made onto the screen
 * everybody reads.
 */
export function HmPrimaryPerformance({ detail }: HmPrimaryPerformanceProps) {
  return (
    <section aria-labelledby="hm-primary" className="space-y-3">
      <h2
        id="hm-primary"
        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        This month
      </h2>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Net gets the full width on a phone. Squeezed into a third of a
            375px row it is no larger than the figures supporting it, which
            loses the one piece of hierarchy this screen has. */}
        <div className="sm:col-span-1">
          <HmMetric metric={detail.net} emphasis="hero" />
        </div>

        <HmMetric metric={detail.target} emphasis="lead" />
        <HmMetric metric={detail.achievement} emphasis="lead" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Net against target
        </p>
        <TargetProgress
          target={detail.targetProgress}
          subject={`${detail.hm.name}, ${detail.month.label}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <HmMetric metric={detail.keyIn} />
        <HmMetric metric={detail.netRatio} />
      </div>
    </section>
  );
}
