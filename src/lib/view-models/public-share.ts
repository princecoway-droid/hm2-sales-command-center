import type { PerformanceStatus } from "@/lib/calculations";
import type { DashboardViewModel } from "@/lib/view-models/dashboard";

/**
 * The public presenter.
 *
 * ---------------------------------------------------------------------------
 *   dashboard view model  ->  THIS FILE  ->  /share/<token>
 * ---------------------------------------------------------------------------
 *
 * A PROJECTION of the model the signed-in dashboard renders, not a second one.
 *
 * That is the whole design. Building the public report from its own view model
 * would mean two presenters selecting figures out of the engine, and the moment
 * one of them was changed the shared report and the private dashboard would
 * disagree about the same month - the single failure this feature cannot have,
 * because the disagreement would be visible to the entire WhatsApp group before
 * it was visible to anyone who could fix it.
 *
 * So the public model is derived: every string on the shared page is a string
 * that was already on the dashboard. There is no formatting decision here, no
 * arithmetic, and nothing that could produce a figure the manager has not
 * already seen.
 *
 * What this file DOES decide is what to leave out, and that is the other half
 * of its job. Dropped on the way through:
 *
 *   hmId, href            internal ids and links into the private app
 *   monthOverMonth, qtd   other months - the token is bound to exactly one
 *   month.id, month.param anything that would let a viewer name a month
 *   notice                messages written for the PA, about the PA's tools
 *
 * Nothing from `profiles`, `auth`, `created_by` or `updated_by` can be dropped
 * here because none of it was ever in the dashboard model to begin with.
 *
 * Pure: no React, no Supabase, no clock.
 */

/** What a figure reads as when it has not been entered. Never "0". */
export const NO_VALUE = "—";

export type PublicKpi = {
  /** Stable, non-identifying. Safe as a React key. */
  key: string;
  label: string;
  /** Already formatted, blanks included. */
  value: string;
  unit: string | null;
  note: string | null;
};

export type PublicWeek = {
  key: string;
  /** "W1", from the sales calendar. */
  label: string;
  /** "30 Aug – 5 Sep", the official Coway period. */
  rangeLabel: string;
  unitsLabel: string;
  status: PerformanceStatus;
  isEntered: boolean;
  /** Height as a share of the tallest entered week, 0-100. */
  barPct: number;
};

export type PublicHmCard = {
  key: string;
  rank: number;
  name: string;
  office: string;
  photoUrl: string | null;
  isActive: boolean;
  netLabel: string;
  keyInLabel: string;
  recruitmentLabel: string;
  recruitmentStatus: PerformanceStatus;
  activeHpLabel: string;
  /** False when nothing has been keyed in for them this month. */
  hasMonthlyRecord: boolean;
};

export type PublicCompleteness = {
  level: "complete" | "partial" | "empty";
  status: PerformanceStatus;
  headline: string;
  detail: string | null;
};

export type PublicTarget = {
  netLabel: string;
  targetLabel: string;
  achievementLabel: string;
  progressPct: number | null;
  hasTarget: boolean;
};

export type PublicShareViewModel = {
  title: string;
  /** The one month this report is about. There is no way to ask for another. */
  monthLabel: string;
  quarterLabel: string;
  /** When the FIGURES were last written, never when the page rendered. */
  updatedLabel: string | null;
  hasAnyData: boolean;
  kpis: PublicKpi[];
  target: PublicTarget;
  weekly: {
    weeks: PublicWeek[];
    hasWeeks: boolean;
    hasEntries: boolean;
    weeksEntered: number;
    weeksConfigured: number;
    totalLabel: string;
  };
  hms: PublicHmCard[];
  completeness: PublicCompleteness;
};

export const PUBLIC_REPORT_TITLE = "HM2 Performance";

/**
 * The shared report, projected from the dashboard.
 *
 * Deliberately takes the built `DashboardViewModel` rather than the raw
 * performance model: by the time a value reaches here it has already been
 * calculated once by the engine and formatted once by the dashboard presenter,
 * and this function is incapable of producing a different one.
 */
export function buildPublicShareViewModel(
  dashboard: DashboardViewModel,
): PublicShareViewModel {
  return {
    title: PUBLIC_REPORT_TITLE,
    monthLabel: dashboard.month.label,
    quarterLabel: dashboard.month.quarterLabel,
    updatedLabel: dashboard.updatedLabel,
    hasAnyData: dashboard.hasAnyData,

    kpis: dashboard.kpis.map((tile) => ({
      key: tile.key,
      label: tile.label,
      value: tile.value,
      unit: tile.unit,
      note: tile.note,
    })),

    target: {
      netLabel: dashboard.target.netLabel,
      targetLabel: dashboard.target.targetLabel,
      achievementLabel: dashboard.target.achievementLabel,
      progressPct: dashboard.target.progressPct,
      hasTarget: dashboard.target.hasTarget,
    },

    weekly: {
      // Keyed by the week's own label rather than its `weekId`: the label is
      // unique within a month, and a database uuid has no business being in the
      // markup of a page anybody can open.
      weeks: dashboard.weekly.weeks.map((week) => ({
        key: week.label,
        label: week.label,
        rangeLabel: week.rangeLabel,
        unitsLabel: week.unitsLabel,
        status: week.status,
        isEntered: week.isEntered,
        barPct: week.barPct,
      })),
      hasWeeks: dashboard.weekly.hasWeeks,
      hasEntries: dashboard.weekly.hasEntries,
      weeksEntered: dashboard.weekly.weeksEntered,
      weeksConfigured: dashboard.weekly.weeksConfigured,
      totalLabel: dashboard.weekly.totalLabel,
    },

    // In the engine's ranked order, and NOT re-sorted. `hmId` and `href` are
    // dropped: the rank is the key, and there is no public HM detail page for a
    // link to point at.
    hms: dashboard.hms.map((hm) => ({
      key: `rank-${hm.rank}`,
      rank: hm.rank,
      name: hm.name,
      office: hm.office,
      photoUrl: hm.photoUrl,
      isActive: hm.isActive,
      netLabel: hm.netLabel,
      keyInLabel: hm.keyInLabel,
      recruitmentLabel: hm.recruitmentLabel,
      recruitmentStatus: hm.recruitmentStatus,
      activeHpLabel: hm.activeHpLabel,
      hasMonthlyRecord: hm.hasMonthlyRecord,
    })),

    // Carried across unchanged, names included. A half-entered month has to
    // read as half-entered to the group as well as to the manager; a shared
    // report that quietly looked complete would be the most damaging thing on
    // the page.
    completeness: {
      level: dashboard.completeness.level,
      status: dashboard.completeness.status,
      headline: dashboard.completeness.headline,
      detail: dashboard.completeness.detail,
    },
  };
}
