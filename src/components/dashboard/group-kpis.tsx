import { KpiCard } from "@/components/dashboard/kpi-card";
import { TargetProgress } from "@/components/dashboard/target-progress";
import type { DashboardViewModel } from "@/lib/view-models/dashboard";

type GroupKpisProps = {
  kpis: DashboardViewModel["kpis"];
  target: DashboardViewModel["target"];
  monthLabel: string;
};

/**
 * The group's month in eight figures.
 *
 * Two columns up to `lg`, four above it, so the reading order is the same on
 * every screen: Key-In, Net, Target, Achievement, then Recruitment, Active HP,
 * Net Ratio, Group SHI. The first four are the sales story and are set larger;
 * the second four support it.
 *
 * The switch is at `lg` rather than `sm` because of the sidebar: between the
 * `md` breakpoint and about 1000px the navigation column takes 224px out of
 * the row, and four cards in what is left forces "ACHIEVEMENT" and its figure
 * wider than the track they are in.
 *
 * The target track sits directly under the cards rather than inside one of
 * them, so Net, Target and Achievement can be read as one statement.
 */
export function GroupKpis({ kpis, target, monthLabel }: GroupKpisProps) {
  const primary = kpis.slice(0, 4);
  const secondary = kpis.slice(4);

  return (
    <section aria-labelledby="group-performance" className="space-y-3 sm:space-y-4">
      <h2 id="group-performance" className="section-label">
        Group performance
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {primary.map((tile) => (
          <KpiCard key={tile.key} tile={tile} emphasis="primary" />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {secondary.map((tile) => (
          <KpiCard key={tile.key} tile={tile} />
        ))}
      </div>

      <div className="glass-panel px-4 py-4 sm:px-5">
        <p className="section-label mb-2.5">Net against target</p>
        <TargetProgress target={target} subject={`Group, ${monthLabel}`} />
      </div>
    </section>
  );
}
