import {
  formatPercentage,
  formatSignedPercentage,
  formatSignedUnits,
  formatUnits,
  type Entry,
  type GroupMonthlyCalculatedPerformance,
  type MetricMonthOverMonth,
  type PerformanceStatus,
  type QtdPerformance,
} from "@/lib/calculations";
import {
  formatUpdatedAt,
  formatWeekRange,
  monthLabel,
  monthParam,
} from "@/lib/calendar";
import { hmDetailPath } from "@/lib/routes";
import { formatMonthLabel } from "@/lib/validation/month";
import type { MonthlyPerformanceViewModel } from "@/lib/view-models/monthly-performance";
import type { Month } from "@/types/models";

/**
 * The dashboard presenter.
 *
 * ---------------------------------------------------------------------------
 *   lib/calculations  ->  monthly-performance  ->  THIS FILE  ->  components
 * ---------------------------------------------------------------------------
 *
 * Everything below is SELECTION and FORMATTING. It decides which already
 * calculated figure belongs on which card and what it reads as on screen; it
 * does not decide what any figure IS. There is no arithmetic here beyond
 * scaling a bar to the width of its track, and deliberately no division of one
 * business figure by another anywhere in the file.
 *
 * It exists so the dashboard components can be pure layout. A component that
 * needs Achievement reads `kpi.value`; it never sees `totalNet` and
 * `totalTarget` in the same scope, so it cannot be tempted to divide them.
 *
 * It also makes the dashboard testable without a DOM: a test asserts that the
 * tile carrying Achievement carries the ENGINE's Achievement, which is the
 * thing that can actually break. Re-deriving 86.2% inside a test would only
 * prove that the test can divide.
 *
 * Pure: no React, no Supabase, no clock. The "updated" stamp is passed in.
 */

/** What a figure reads as when it has not been entered. Never "0". */
export const NO_VALUE = "—";

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

export type KpiKey =
  | "keyIn"
  | "net"
  | "target"
  | "achievement"
  | "recruitment"
  | "activeHp"
  | "netRatio"
  | "shi";

export type KpiTile = {
  key: KpiKey;
  label: string;
  /** Already formatted, blanks included. A component renders it as-is. */
  value: string;
  /**
   * "units" and the like, or `null` when the figure carries its own - and also
   * `null` when the figure is blank, because "— units" reads as a broken
   * number rather than as a missing one.
   */
  unit: string | null;
  /** One short line under the number when there is no unit to show. */
  note: string | null;
};

export type TargetProgressModel = {
  netLabel: string;
  targetLabel: string;
  achievementLabel: string;
  /**
   * Bar width, 0-100, or `null` when there is no target to draw against.
   *
   * Clamped: 118% achievement fills the track and the real figure is shown in
   * text beside it, because a bar overflowing its track reads as a rendering
   * bug rather than as good news. The clamp is presentation only and never
   * touches `achievementLabel`, which always shows what was achieved.
   */
  progressPct: number | null;
  hasTarget: boolean;
};

export type WeeklyBar = {
  weekId: string;
  /** "W1", from the sales calendar - never derived from the dates. */
  label: string;
  /** "30 Aug – 5 Sep", the official Coway period. */
  rangeLabel: string;
  units: Entry;
  unitsLabel: string;
  /** The engine's locked band. A blank week is neutral, never red. */
  status: PerformanceStatus;
  isEntered: boolean;
  /** Height of the bar as a share of the tallest entered week, 0-100. */
  barPct: number;
  /** HMs who have keyed this week in. */
  hmsEntered: number;
};

export type WeeklyChartModel = {
  weeks: WeeklyBar[];
  /** False when the Coway periods have not been configured for this month. */
  hasWeeks: boolean;
  /** False when no week holds a single figure yet. */
  hasEntries: boolean;
  weeksEntered: number;
  weeksConfigured: number;
  totalLabel: string;
};

export type HmCardModel = {
  rank: number;
  hmId: string;
  /**
   * The HM's own screen, with the reporting month carried across.
   *
   * Built here rather than in the card so the month cannot be dropped on the
   * way: a card that linked to `/hm/<id>` alone would land the manager
   * on today's month while they were plainly looking at August.
   */
  href: string;
  name: string;
  office: string;
  photoUrl: string | null;
  isActive: boolean;
  netLabel: string;
  keyInLabel: string;
  recruitmentLabel: string;
  recruitmentStatus: PerformanceStatus;
  activeHpLabel: string;
  targetLabel: string;
  achievementLabel: string;
  progressPct: number | null;
  hasTarget: boolean;
  /** False when the PA has not keyed this HM in for the month at all. */
  hasMonthlyRecord: boolean;
};

export type CompletenessModel = {
  level: "complete" | "partial" | "empty";
  status: PerformanceStatus;
  headline: string;
  /** Who is outstanding, or what else is worth saying. */
  detail: string | null;
  hmRecordsPresent: number;
  activeHmCount: number;
};

export type MonthOverMonthModel = {
  hasPreviousMonth: boolean;
  previousMonthLabel: string | null;
  previousNetLabel: string;
  currentNetLabel: string;
  changeUnitsLabel: string;
  changePercentageLabel: string;
  direction: "up" | "down" | "flat" | "unknown";
  /** Shown instead of the figures when there is nothing to compare against. */
  emptyMessage: string | null;
};

export type QtdModel = {
  quarterLabel: string;
  netLabel: string;
  recruitmentLabel: string;
  isComplete: boolean;
  monthsLabel: string;
  /** "No data yet: July 2026" - never left implicit. */
  incompleteMessage: string | null;
};

/** Why this month is on screen, phrased for the manager reading it. */
export type DashboardNotice = {
  tone: "info" | "warning";
  title: string;
  body: string;
};

export type DashboardMonthModel = {
  id: string;
  label: string;
  /** The `?month=` value. */
  param: string;
  quarterLabel: string;
};

export type DashboardViewModel = {
  month: DashboardMonthModel;
  /** When the records were last written, or `null` if never. */
  updatedLabel: string | null;
  notice: DashboardNotice | null;
  /** False when the month exists but nobody has keyed anything into it. */
  hasAnyData: boolean;
  kpis: KpiTile[];
  target: TargetProgressModel;
  weekly: WeeklyChartModel;
  hms: HmCardModel[];
  completeness: CompletenessModel;
  monthOverMonth: MonthOverMonthModel;
  qtd: QtdModel;
};

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

/**
 * A group total nobody has contributed to reads as blank, not as zero.
 *
 * The engine returns `{ total: 0, contributors: 0 }` for a column no HM has
 * filled in - a true statement about a sum of nothing, and a lie the moment it
 * is printed on a card as "0 units". The contributor count is the engine's own
 * answer to "did anyone enter this", so it is what decides whether the total is
 * worth showing.
 */
function totalLabel(total: number, contributors: number): string {
  return contributors > 0 ? formatUnits(total) : NO_VALUE;
}

/** Bar width for an achievement percentage. See `TargetProgressModel`. */
export function progressWidth(achievementPct: number | null): number | null {
  if (achievementPct === null) {
    return null;
  }

  return Math.max(0, Math.min(100, achievementPct));
}

export function quarterLabel(quarter: number, year: number): string {
  return `Q${quarter} ${year}`;
}

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

/** "units" for a real figure, nothing at all for a blank one. */
function unitFor(value: string): string | null {
  return value === NO_VALUE ? null : "units";
}

function buildKpis(group: GroupMonthlyCalculatedPerformance): KpiTile[] {
  const { contributors } = group;
  const anyWeekEntered = group.weeklyGroupKeyIn.some((week) => week.isEntered);

  // Derived from the weeks, so "no week has been entered" is what makes it
  // blank - there is no keyed monthly Key-In field that could be missing.
  const keyIn = anyWeekEntered ? formatUnits(group.totalKeyIn) : NO_VALUE;
  const net = totalLabel(group.totalNet, contributors.net);
  const target = totalLabel(group.totalTarget, contributors.target);

  return [
    {
      key: "keyIn",
      label: "Key-In",
      value: keyIn,
      unit: unitFor(keyIn),
      note: anyWeekEntered ? null : "No weeks entered",
    },
    {
      key: "net",
      label: "Net",
      value: net,
      unit: unitFor(net),
      note: contributors.net === 0 ? "Not entered" : null,
    },
    {
      key: "target",
      label: "Target",
      value: target,
      unit: unitFor(target),
      note: contributors.target === 0 ? "Not set" : null,
    },
    {
      key: "achievement",
      label: "Achievement",
      value: formatPercentage(group.groupAchievementPct, { fallback: NO_VALUE }),
      unit: null,
      note:
        group.groupAchievementPct === null ? "Needs a target" : "Net vs target",
    },
    {
      key: "recruitment",
      label: "Recruitment",
      value: totalLabel(group.totalRecruitment, contributors.recruitment),
      unit: null,
      note: "New this month",
    },
    {
      key: "activeHp",
      label: "Active HP",
      value: totalLabel(group.totalActiveHp, contributors.activeHp),
      unit: null,
      note: "From eTrust",
    },
    {
      key: "netRatio",
      label: "Net ratio",
      value: formatPercentage(group.groupNetRatioPct, { fallback: NO_VALUE }),
      unit: null,
      note: group.groupNetRatioPct === null ? "Needs Key-In" : "Net vs Key-In",
    },
    {
      key: "shi",
      label: "Group SHI",
      // Read straight from `group_monthly_metrics`. Never the average of the HM
      // SHI column, and blank rather than substituted when eTrust has not been
      // keyed in.
      value: formatPercentage(group.groupShiPct, { fallback: NO_VALUE }),
      unit: null,
      note: group.groupShiPct === null ? "Not entered" : "From eTrust",
    },
  ];
}

function buildTarget(
  group: GroupMonthlyCalculatedPerformance,
): TargetProgressModel {
  const hasTarget = group.contributors.target > 0 && group.totalTarget > 0;

  return {
    netLabel: totalLabel(group.totalNet, group.contributors.net),
    targetLabel: totalLabel(group.totalTarget, group.contributors.target),
    achievementLabel: formatPercentage(group.groupAchievementPct, {
      fallback: NO_VALUE,
    }),
    progressPct: hasTarget ? progressWidth(group.groupAchievementPct) : null,
    hasTarget,
  };
}

function buildWeekly(
  group: GroupMonthlyCalculatedPerformance,
): WeeklyChartModel {
  const weeks = group.weeklyGroupKeyIn;

  // The tallest ENTERED week sets the scale. A blank week has no height to
  // give, and letting one into the maximum would silently rescale the chart.
  const tallest = weeks.reduce(
    (max, week) =>
      week.isEntered && week.keyInUnits > max ? week.keyInUnits : max,
    0,
  );

  const weeksEntered = weeks.filter((week) => week.isEntered).length;

  return {
    weeks: weeks.map((week) => ({
      weekId: week.weekId,
      label: week.weekLabel,
      rangeLabel: formatWeekRange({
        start_date: week.startDate,
        end_date: week.endDate,
      }),
      units: week.isEntered ? week.keyInUnits : null,
      unitsLabel: week.isEntered ? formatUnits(week.keyInUnits) : NO_VALUE,
      status: week.status,
      isEntered: week.isEntered,
      barPct:
        week.isEntered && tallest > 0 ? (week.keyInUnits / tallest) * 100 : 0,
      hmsEntered: week.hmsEntered,
    })),
    hasWeeks: weeks.length > 0,
    hasEntries: weeksEntered > 0,
    weeksEntered,
    weeksConfigured: weeks.length,
    totalLabel: weeksEntered > 0 ? formatUnits(group.totalKeyIn) : NO_VALUE,
  };
}

function buildHmCards(
  model: MonthlyPerformanceViewModel,
  month: string,
): HmCardModel[] {
  // Straight off the Stage 3 ranking - Net descending, with a total tie-break.
  // Nothing here re-sorts: two surfaces disagreeing about who is second is
  // exactly what that ranking exists to prevent.
  return model.rankings.map((entry) => {
    const hm = entry.performance;
    const hasTarget = hm.targetNetUnits !== null && hm.targetNetUnits > 0;

    return {
      rank: entry.rank,
      hmId: hm.hmId,
      href: hmDetailPath(hm.hmId, month),
      name: hm.hmName,
      office: hm.office,
      photoUrl: hm.photoUrl,
      isActive: hm.isActive,
      netLabel: hm.netUnits === null ? NO_VALUE : formatUnits(hm.netUnits),
      keyInLabel:
        hm.presence.weeksEntered > 0 ? formatUnits(hm.totalKeyIn) : NO_VALUE,
      recruitmentLabel:
        hm.recruitment === null ? NO_VALUE : formatUnits(hm.recruitment),
      recruitmentStatus: hm.recruitmentStatus,
      activeHpLabel: hm.activeHp === null ? NO_VALUE : formatUnits(hm.activeHp),
      targetLabel:
        hm.targetNetUnits === null ? NO_VALUE : formatUnits(hm.targetNetUnits),
      achievementLabel: formatPercentage(hm.achievementPct, {
        fallback: NO_VALUE,
      }),
      progressPct: hasTarget ? progressWidth(hm.achievementPct) : null,
      hasTarget,
      hasMonthlyRecord: hm.presence.hasMonthlyRecord,
    };
  });
}

function buildCompleteness(
  group: GroupMonthlyCalculatedPerformance,
): CompletenessModel {
  const completeness = group.dataCompleteness;
  const namesById = new Map(group.hms.map((hm) => [hm.hmId, hm.hmName] as const));

  const missingNames = completeness.missingHmIds
    .map((id) => namesById.get(id))
    .filter((name): name is string => Boolean(name));

  const level =
    completeness.activeHmCount === 0 || completeness.hmRecordsPresent === 0
      ? "empty"
      : completeness.isComplete
        ? "complete"
        : "partial";

  const status: PerformanceStatus =
    level === "complete" ? "green" : level === "partial" ? "yellow" : "red";

  const headline =
    completeness.activeHmCount === 0
      ? "No active HMs"
      : completeness.isComplete
        ? `All ${completeness.activeHmCount} HMs updated`
        : `${completeness.hmRecordsPresent} of ${completeness.activeHmCount} HMs updated`;

  const detail =
    missingNames.length > 0
      ? `Nothing entered yet: ${missingNames.join(", ")}`
      : completeness.weeksConfigured === 0
        ? "No sales weeks configured for this month"
        : null;

  return {
    level,
    status,
    headline,
    detail,
    hmRecordsPresent: completeness.hmRecordsPresent,
    activeHmCount: completeness.activeHmCount,
  };
}

/**
 * A month-over-month comparison, formatted.
 *
 * Takes the metric-agnostic engine shape, so the group's Net comparison and an
 * HM's recruitment comparison are presented by the same function - including
 * the two cases a screen would otherwise get wrong on its own: an absent
 * previous month says so instead of showing a change, and a previous month of 0
 * keeps its unit difference but has no percentage.
 */
export function buildMonthOverMonthModel(
  comparison: MetricMonthOverMonth,
): MonthOverMonthModel {
  const previousMonthLabel = comparison.previousMonth
    ? formatMonthLabel(
        comparison.previousMonth.year,
        comparison.previousMonth.month,
      )
    : null;

  const direction: MonthOverMonthModel["direction"] =
    comparison.differenceUnits === null
      ? "unknown"
      : comparison.differenceUnits > 0
        ? "up"
        : comparison.differenceUnits < 0
          ? "down"
          : "flat";

  return {
    hasPreviousMonth: comparison.hasPreviousMonthData,
    previousMonthLabel,
    previousNetLabel:
      comparison.previousValue === null
        ? NO_VALUE
        : formatUnits(comparison.previousValue),
    currentNetLabel: formatUnits(comparison.currentValue),
    changeUnitsLabel: formatSignedUnits(comparison.differenceUnits, {
      fallback: NO_VALUE,
    }),
    // Blank when the previous month was 0 as well as when it is absent: there
    // is no percentage increase from nothing, and "+∞%" is not a figure.
    changePercentageLabel: formatSignedPercentage(comparison.percentageChange, {
      fallback: NO_VALUE,
    }),
    direction,
    emptyMessage: comparison.hasPreviousMonthData
      ? null
      : "No previous month data",
  };
}

export function buildQtdModel(qtd: QtdPerformance): QtdModel {
  const missing = qtd.missingMonths.map((month) =>
    formatMonthLabel(month.year, month.month),
  );

  return {
    quarterLabel: quarterLabel(qtd.quarter, qtd.year),
    netLabel: formatUnits(qtd.netUnits),
    recruitmentLabel: formatUnits(qtd.recruitment),
    isComplete: qtd.isComplete,
    monthsLabel: `${qtd.monthsWithData} of ${qtd.monthsToDate.length} months`,
    incompleteMessage:
      missing.length > 0 ? `No data yet: ${missing.join(", ")}` : null,
  };
}

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

export type DashboardPresenterInput = {
  selectedMonth: Month;
  performance: MonthlyPerformanceViewModel;
  /** Latest `updated_at` across the month's records, or `null`. */
  lastUpdatedAt: string | null;
  notice?: DashboardNotice | null;
};

export function buildDashboardViewModel({
  selectedMonth,
  performance,
  lastUpdatedAt,
  notice = null,
}: DashboardPresenterInput): DashboardViewModel {
  const { group } = performance;
  const param = monthParam(selectedMonth);

  return {
    month: {
      id: selectedMonth.id,
      label: monthLabel(selectedMonth),
      param,
      quarterLabel: quarterLabel(selectedMonth.quarter, selectedMonth.year),
    },
    updatedLabel: formatUpdatedAt(lastUpdatedAt),
    notice,
    hasAnyData: group.hasAnyData,
    kpis: buildKpis(group),
    target: buildTarget(group),
    weekly: buildWeekly(group),
    hms: buildHmCards(performance, param),
    completeness: buildCompleteness(group),
    monthOverMonth: buildMonthOverMonthModel(performance.previousMonth),
    qtd: buildQtdModel(performance.qtd),
  };
}
