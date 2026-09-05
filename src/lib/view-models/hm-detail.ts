import {
  formatPercentage,
  formatUnits,
  type Entry,
  type HMMonthlyCalculatedPerformance,
  type PerformanceStatus,
} from "@/lib/calculations";
import { formatUpdatedAt, formatWeekRange, monthLabel, monthParam } from "@/lib/calendar";
import { dashboardPath } from "@/lib/routes";
import {
  buildMonthOverMonthModel,
  buildQtdModel,
  progressWidth,
  quarterLabel,
  NO_VALUE,
  type DashboardNotice,
  type MonthOverMonthModel,
  type QtdModel,
  type TargetProgressModel,
} from "@/lib/view-models/dashboard";
import type { HmPerformanceViewModel } from "@/lib/view-models/monthly-performance";
import type { Month } from "@/types/models";

/**
 * The HM detail presenter.
 *
 * ---------------------------------------------------------------------------
 *   lib/calculations  ->  monthly-performance  ->  THIS FILE  ->  components
 * ---------------------------------------------------------------------------
 *
 * The same seam Stage 4 established, for one person instead of the group:
 * SELECTION and FORMATTING only. Achievement, Net Ratio, the Extrade split, the
 * weekly bands, the month-over-month change and the quarter are all decided in
 * `lib/calculations`; nothing here divides one business figure by another, and
 * the only arithmetic in the file scales a bar to the width of its track.
 *
 * Where a figure has a dashboard equivalent - the target track, the
 * month-over-month block, the quarter panel - the dashboard's own builder is
 * called rather than a second one written here. That is not tidiness: it is
 * what makes "the HM's Net on their page equals their Net on the dashboard" a
 * property of the code rather than something to re-test after every change.
 */

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

/**
 * One figure on the HM's screen.
 *
 * Everything is a string by the time it gets here, blanks included. `status` is
 * the ENGINE's band and is only ever set for the two figures that have one -
 * weekly Key-In and recruitment - so no component can invent a threshold for a
 * metric the business has not defined one for.
 */
export type HmMetricModel = {
  key: string;
  label: string;
  /** Already formatted. `—` when nothing has been entered. */
  value: string;
  /** "units", or `null` - including when the value is blank, so no "— units". */
  unit: string | null;
  /** One short supporting line: where the figure comes from, or that it is missing. */
  note: string | null;
  /** The engine's band, or `null` for a figure with no defined band. */
  status: PerformanceStatus | null;
  /** The band in words. Status is never carried by colour alone. */
  statusLabel: string | null;
};

/** One Coway period on the HM's weekly strip. */
export type HmWeeklyBarModel = {
  weekId: string;
  /** "W1", from the sales calendar - never derived from the dates. */
  label: string;
  /** "30 Aug – 5 Sep", the official Coway period. */
  rangeLabel: string;
  unitsLabel: string;
  status: PerformanceStatus;
  statusLabel: string;
  isEntered: boolean;
  /** Length of the bar as a share of this HM's tallest entered week, 0-100. */
  barPct: number;
};

export type HmWeeklyModel = {
  weeks: HmWeeklyBarModel[];
  /** False when the Coway periods have not been configured for this month. */
  hasWeeks: boolean;
  /** False when no week holds a figure yet. */
  hasEntries: boolean;
  weeksEntered: number;
  weeksConfigured: number;
  /** The month's Key-In: the SUM of the entered weeks, from the engine. */
  totalLabel: string;
  entriesLabel: string;
};

export type HmSalesMixEntryModel = {
  label: string;
  unitsLabel: string;
  percentageLabel: string;
  /** Share of Net as a bar width, 0-100, or `null` when there is no share. */
  barPct: number | null;
};

export type HmSalesMixModel = {
  extrade: HmSalesMixEntryModel;
  nonExtrade: HmSalesMixEntryModel;
  /** False until both halves of the split have been keyed in. */
  hasSplit: boolean;
  /** "OK", or the signed difference - `+1` is one unit too many. */
  balanceLabel: string;
  isBalanced: boolean;
  /** Said in words, because the balance is the one thing a reader must not miss. */
  balanceNote: string;
};

export type HmIdentityModel = {
  id: string;
  name: string;
  office: string;
  photoUrl: string | null;
  isActive: boolean;
  /** "Rank 3 of 12", or `null` when the month does not cover this HM. */
  rankLabel: string | null;
};

export type HmDetailMonthModel = {
  id: string;
  label: string;
  /** The `?month=` value. */
  param: string;
  quarterLabel: string;
};

export type HmDetailViewModel = {
  hm: HmIdentityModel;
  month: HmDetailMonthModel;
  /**
   * Where "back" goes: the dashboard on the month being looked at, or - behind
   * a share token - the report the HM was opened from. See the presenter input.
   */
  backHref: string;
  /** When the month's records were last written, or `null` if never. */
  updatedLabel: string | null;
  notice: DashboardNotice | null;

  /** A row exists in `hm_monthly_performance` for this HM and month. */
  hasMonthlyRecord: boolean;
  /** Anything at all: a monthly row, or one week of Key-In. */
  hasAnyData: boolean;
  /** What to say when the month holds nothing for this HM. `null` when it does. */
  emptyMessage: string | null;

  // Primary
  net: HmMetricModel;
  target: HmMetricModel;
  achievement: HmMetricModel;
  keyIn: HmMetricModel;
  netRatio: HmMetricModel;
  /** Net against target as a track, in the dashboard's own shape. */
  targetProgress: TargetProgressModel;

  // Secondary
  secondary: HmMetricModel[];

  weekly: HmWeeklyModel;
  salesMix: HmSalesMixModel;
  previousMonthNet: MonthOverMonthModel;
  previousMonthRecruitment: MonthOverMonthModel;
  qtd: QtdModel;
};

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

/** A blank entry reads as an em dash, never as 0. */
function unitsLabel(value: Entry): string {
  return value === null ? NO_VALUE : formatUnits(value);
}

/** "units" for a real figure, nothing at all for a blank one. */
function unitFor(value: string): string | null {
  return value === NO_VALUE ? null : "units";
}

const STATUS_WORDS: Record<PerformanceStatus, string> = {
  green: "GREEN",
  yellow: "YELLOW",
  red: "RED",
  neutral: "NEUTRAL",
};

/**
 * The band in words.
 *
 * Deliberately the plain colour word rather than a judgement. The bands are the
 * business's own - above 15, 10 to 15, below 10 - and a screen reader user is
 * owed the same signal a sighted one gets from the dot, not an interpretation
 * of it that the sighted reader never sees.
 */
export function statusWord(status: PerformanceStatus): string {
  return STATUS_WORDS[status];
}

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

function buildWeekly(hm: HMMonthlyCalculatedPerformance): HmWeeklyModel {
  const weeks = hm.weeklyPerformance;

  // The tallest ENTERED week sets the scale. A blank week has no height to
  // give, and letting one into the maximum would silently rescale the strip.
  const tallest = weeks.reduce(
    (max, week) =>
      week.isEntered && week.keyInUnits !== null && week.keyInUnits > max
        ? week.keyInUnits
        : max,
    0,
  );

  const weeksEntered = hm.presence.weeksEntered;

  return {
    weeks: weeks.map((week) => ({
      weekId: week.weekId,
      label: week.weekLabel,
      rangeLabel: formatWeekRange({
        start_date: week.startDate,
        end_date: week.endDate,
      }),
      unitsLabel: unitsLabel(week.keyInUnits),
      status: week.status,
      statusLabel: statusWord(week.status),
      isEntered: week.isEntered,
      barPct:
        week.isEntered && week.keyInUnits !== null && tallest > 0
          ? (week.keyInUnits / tallest) * 100
          : 0,
    })),
    hasWeeks: weeks.length > 0,
    hasEntries: weeksEntered > 0,
    weeksEntered,
    weeksConfigured: hm.presence.weeksConfigured,
    // The engine's sum of the entered weeks - there is no stored monthly Key-In.
    totalLabel: weeksEntered > 0 ? formatUnits(hm.totalKeyIn) : NO_VALUE,
    entriesLabel: `${weeksEntered} of ${hm.presence.weeksConfigured} weeks entered`,
  };
}

/**
 * The Extrade mix.
 *
 * The percentages are the engine's, both off TOTAL KEY-IN, and the balance is
 * the engine's signed difference against the same total. Nothing is divided
 * here - which matters more on this screen than anywhere else, because Extrade
 * over Net is exactly the sum somebody would be tempted to write inline next to
 * two numbers already on the page, and Net is the wrong denominator.
 *
 * Extrade and Non-Extrade are independent keyed figures: the balance line
 * describes how they sit against Key-In, it does not report a broken rule.
 */
function buildSalesMix(hm: HMMonthlyCalculatedPerformance): HmSalesMixModel {
  const hasSplit = hm.extradeUnits !== null && hm.nonExtradeUnits !== null;
  const balance = hm.splitBalance;
  const isBalanced = balance === 0;

  return {
    extrade: {
      label: "Extrade",
      unitsLabel: unitsLabel(hm.extradeUnits),
      percentageLabel: formatPercentage(hm.extradePct, { fallback: NO_VALUE }),
      barPct: progressWidth(hm.extradePct),
    },
    nonExtrade: {
      label: "Non-Extrade",
      unitsLabel: unitsLabel(hm.nonExtradeUnits),
      percentageLabel: formatPercentage(hm.nonExtradePct, {
        fallback: NO_VALUE,
      }),
      barPct: progressWidth(hm.nonExtradePct),
    },
    hasSplit,
    balanceLabel:
      balance === null
        ? NO_VALUE
        : isBalanced
          ? "OK"
          : `${balance > 0 ? "+" : "−"}${Math.abs(balance)}`,
    isBalanced,
    balanceNote:
      balance === null
        ? "Split not entered"
        : isBalanced
          ? "The split comes to the Key-In total exactly"
          : balance > 0
            ? "The split comes to more than Key-In"
            : "The split comes to less than Key-In",
  };
}

function buildSecondary(hm: HMMonthlyCalculatedPerformance): HmMetricModel[] {
  const recruitment = unitsLabel(hm.recruitment);

  return [
    {
      key: "recruitment",
      label: "Recruitment",
      value: recruitment,
      unit: null,
      note: hm.recruitment === null ? "Not entered" : "New this month",
      // The one band the business has defined for this figure: >=3 green,
      // 1-2 yellow, 0 red. Applied by the engine, read here.
      status: hm.recruitmentStatus,
      statusLabel: statusWord(hm.recruitmentStatus),
    },
    {
      key: "activeHp",
      label: "Active HP",
      value: unitsLabel(hm.activeHp),
      unit: null,
      // Keyed in from eTrust. Never recalculated from sales.
      note: hm.activeHp === null ? "Not entered" : "From eTrust",
      status: null,
      statusLabel: null,
    },
    {
      key: "shi",
      label: "SHI",
      // Read straight from the monthly row. Never an average, never the group
      // figure, never last month's.
      value: formatPercentage(hm.shiPct, { fallback: NO_VALUE }),
      unit: null,
      note: hm.shiPct === null ? "Not entered" : "From eTrust",
      status: null,
      statusLabel: null,
    },
  ];
}

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

export type HmDetailPresenterInput = {
  selectedMonth: Month;
  model: HmPerformanceViewModel;
  /** Latest `updated_at` across the month's records, or `null`. */
  lastUpdatedAt: string | null;
  notice?: DashboardNotice | null;
  /**
   * Where "back" goes. Defaults to the dashboard on the month being looked at.
   *
   * Overridden by exactly one caller: the read-only view behind a share token,
   * which has to return to the report it was opened from rather than to a
   * screen its viewer cannot reach. Passing it in rather than patching the
   * model afterwards keeps the route into the private app out of a public
   * page's model entirely, instead of merely unrendered.
   */
  backHref?: string;
};

export function buildHmDetailViewModel({
  selectedMonth,
  model,
  lastUpdatedAt,
  notice = null,
  backHref,
}: HmDetailPresenterInput): HmDetailViewModel {
  const hm = model.performance;

  const net = unitsLabel(hm.netUnits);
  const target = unitsLabel(hm.targetNetUnits);
  const hasTarget = hm.targetNetUnits !== null && hm.targetNetUnits > 0;
  const keyIn = hm.presence.weeksEntered > 0 ? formatUnits(hm.totalKeyIn) : NO_VALUE;

  return {
    hm: {
      id: hm.hmId,
      name: hm.hmName,
      office: hm.office,
      photoUrl: hm.photoUrl,
      isActive: hm.isActive,
      rankLabel:
        model.rank === null
          ? null
          : `Rank ${model.rank} of ${model.rankedOutOf}`,
    },

    month: {
      id: selectedMonth.id,
      label: monthLabel(selectedMonth),
      param: monthParam(selectedMonth),
      quarterLabel: quarterLabel(selectedMonth.quarter, selectedMonth.year),
    },

    backHref: backHref ?? dashboardPath(monthParam(selectedMonth)),
    updatedLabel: formatUpdatedAt(lastUpdatedAt),
    notice,

    hasMonthlyRecord: hm.presence.hasMonthlyRecord,
    hasAnyData: hm.presence.hasAnyData,
    emptyMessage: hm.presence.hasAnyData
      ? null
      : `No performance data entered for ${monthLabel(selectedMonth)}.`,

    net: {
      key: "net",
      label: "Net",
      value: net,
      unit: unitFor(net),
      note: hm.netUnits === null ? "Not entered" : null,
      status: null,
      statusLabel: null,
    },
    target: {
      key: "target",
      label: "Target",
      value: target,
      unit: unitFor(target),
      // A target of 0 is a real, entered zero, and it still means achievement
      // cannot be calculated - so it says "not set" rather than showing 0%.
      note: hasTarget ? null : "Target not set",
      status: null,
      statusLabel: null,
    },
    achievement: {
      key: "achievement",
      label: "Achievement",
      value: formatPercentage(hm.achievementPct, { fallback: NO_VALUE }),
      unit: null,
      note: hm.achievementPct === null ? "Needs a target" : "Net vs target",
      // No bands. The business has not defined achievement thresholds, so this
      // screen reports the figure and stops.
      status: null,
      statusLabel: null,
    },
    keyIn: {
      key: "keyIn",
      label: "Key-In",
      value: keyIn,
      unit: unitFor(keyIn),
      note: hm.presence.weeksEntered > 0 ? "Sum of entered weeks" : "No weeks entered",
      status: null,
      statusLabel: null,
    },
    netRatio: {
      key: "netRatio",
      label: "Net ratio",
      value: formatPercentage(hm.netRatioPct, { fallback: NO_VALUE }),
      unit: null,
      note: hm.netRatioPct === null ? "Needs Key-In" : "Net vs Key-In",
      status: null,
      statusLabel: null,
    },

    targetProgress: {
      netLabel: net,
      targetLabel: target,
      achievementLabel: formatPercentage(hm.achievementPct, {
        fallback: NO_VALUE,
      }),
      progressPct: hasTarget ? progressWidth(hm.achievementPct) : null,
      hasTarget,
    },

    secondary: buildSecondary(hm),
    weekly: buildWeekly(hm),
    salesMix: buildSalesMix(hm),
    previousMonthNet: buildMonthOverMonthModel(model.previousMonthNet),
    previousMonthRecruitment: buildMonthOverMonthModel(
      model.previousMonthRecruitment,
    ),
    qtd: buildQtdModel(model.qtd),
  };
}
