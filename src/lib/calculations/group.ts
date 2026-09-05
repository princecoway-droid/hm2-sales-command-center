import type { HMMonthlyCalculatedPerformance } from "@/lib/calculations/hm";
import type { MonthInput, SalesWeekInput } from "@/lib/calculations/inputs";
import {
  isEntered,
  netRatio,
  splitBalance,
  percentageOf,
  weeklyKeyInStatus,
  type Entry,
  type Percentage,
  type PerformanceStatus,
} from "@/lib/calculations/performance";

/**
 * Group aggregation.
 *
 * Every group figure is computed from the HM models, never stored and never
 * averaged. The two rules that keep it honest:
 *
 *   Totals sum HM figures. There is no manually keyed group total anywhere in
 *   the schema, so a group number cannot drift away from the rows beneath it.
 *
 *   Percentages come off group totals, not off HM percentages. The mean of four
 *   achievement percentages is not the group achievement - it silently weights
 *   an HM with a target of 20 the same as one with a target of 200. Group
 *   Achievement is total Net over total Target, and Group Net Ratio, Extrade %
 *   and Non-Extrade % work the same way.
 *
 * The one exception, and it is an exception to both rules: GROUP SHI. It is an
 * independent eTrust figure keyed straight into `group_monthly_metrics`, so it
 * is read and passed through untouched. It is never an average, weighted or
 * otherwise, of the HM SHI column, and when the record is missing it is `null`
 * rather than falling back to anything.
 */

// -----------------------------------------------------------------------------
// Summing, with blanks preserved
// -----------------------------------------------------------------------------

/**
 * A group total, plus how many HMs actually contributed to it.
 *
 * The count is the point. A total of 270 built from four HMs and a total of 270
 * built from two of an expected four are different claims, and the second one
 * is only safe to show next to something saying so.
 */
export type GroupTotal = {
  /** Sum of the entered values. Blanks contribute nothing, not zero. */
  total: number;
  /** HMs whose figure was entered. */
  contributors: number;
};

function sumEntries(values: readonly Entry[]): GroupTotal {
  let total = 0;
  let contributors = 0;

  for (const value of values) {
    if (isEntered(value)) {
      total += value;
      contributors += 1;
    }
  }

  return { total, contributors };
}

// -----------------------------------------------------------------------------
// Completeness
// -----------------------------------------------------------------------------

/**
 * Has the PA updated every active HM for this month?
 *
 * Counts, not a score. Two things are tracked separately on purpose:
 *
 *   MONTHLY RECORD completeness - the question above. An active HM with no row
 *   in `hm_monthly_performance` is missing, full stop.
 *
 *   WEEKLY ENTRY completeness - how much of the sales calendar has been keyed
 *   in. Blank weeks are normal in a month still in progress, so this never
 *   feeds `isComplete`. It exists so a UI can say "3 of 5 weeks entered"
 *   without that being read as a failure.
 *
 * Only ACTIVE HMs count towards `activeHmCount` and `missingHmIds`. An inactive
 * HM who is present because of history is not an outstanding record - nobody is
 * going to key in figures for somebody who has left.
 */
export type DataCompleteness = {
  /** Active HMs expected to have a record this month. */
  activeHmCount: number;
  /** Of those, how many have a monthly row. */
  hmRecordsPresent: number;
  /** Active HMs with no monthly row, in display order. */
  missingHmIds: string[];
  /** True when every active HM has a monthly record. Weekly blanks do not affect it. */
  isComplete: boolean;
  /** HMs included in the figures, active plus inactive-with-history. */
  includedHmCount: number;
  /** Inactive HMs carried for their history. Counted, never chased. */
  inactiveWithHistoryCount: number;

  // Weekly entry completeness - reported, never folded into `isComplete`.
  weeksConfigured: number;
  /** `activeHmCount x weeksConfigured` - the cells a finished month would hold. */
  weeklyCellsExpected: number;
  weeklyCellsEntered: number;
};

export function calculateDataCompleteness(
  performances: readonly HMMonthlyCalculatedPerformance[],
  weeksConfigured: number,
): DataCompleteness {
  const active = performances.filter((hm) => hm.isActive);

  const missingHmIds = active
    .filter((hm) => !hm.presence.hasMonthlyRecord)
    .map((hm) => hm.hmId);

  const weeklyCellsEntered = active.reduce(
    (count, hm) => count + hm.presence.weeksEntered,
    0,
  );

  return {
    activeHmCount: active.length,
    hmRecordsPresent: active.length - missingHmIds.length,
    missingHmIds,
    // An empty roster is not "complete" - there is nothing to be complete about,
    // and reporting a green tick for a month with no HMs would be a lie.
    isComplete: active.length > 0 && missingHmIds.length === 0,
    includedHmCount: performances.length,
    inactiveWithHistoryCount: performances.length - active.length,
    weeksConfigured,
    weeklyCellsExpected: active.length * weeksConfigured,
    weeklyCellsEntered,
  };
}

// -----------------------------------------------------------------------------
// Weekly group Key-In
// -----------------------------------------------------------------------------

/** One column of the future weekly Key-In graph. */
export type GroupWeeklyKeyIn = {
  weekId: string;
  weekNumber: number;
  weekLabel: string;
  startDate: string;
  endDate: string;
  /** SUM of every HM Key-In for this week. Blanks contribute nothing. */
  keyInUnits: number;
  /** HMs who have a figure for this week. */
  hmsEntered: number;
  /** True once anyone has keyed this week in. A week nobody has is not a zero week. */
  isEntered: boolean;
  /**
   * The locked weekly band applied to the group total: >15 green, 10-15 yellow,
   * <10 red, and `neutral` for a week nobody has keyed in.
   *
   * It lives on the model rather than in the chart for the usual reason - the
   * thresholds have exactly one definition, in `weeklyKeyInStatus` - and
   * because the blank case is the one a component gets wrong: a week with no
   * figures totals 0, and colouring that red would report a catastrophic week
   * for the four days of September that have not happened yet.
   */
  status: PerformanceStatus;
};

export function calculateGroupWeeklyKeyIn(
  performances: readonly HMMonthlyCalculatedPerformance[],
  weeks: readonly SalesWeekInput[],
): GroupWeeklyKeyIn[] {
  // Keyed by week id rather than by array position. The HM models are normally
  // built from this very week list, but this function is exported, and a
  // positional lookup would silently attribute one week Key-In to another the
  // first time somebody passed a differently ordered list.
  const totals = new Map<string, { keyInUnits: number; hmsEntered: number }>(
    weeks.map((week) => [week.weekId, { keyInUnits: 0, hmsEntered: 0 }] as const),
  );

  for (const hm of performances) {
    for (const cell of hm.weeklyPerformance) {
      const running = totals.get(cell.weekId);

      if (!running || !cell.isEntered || cell.keyInUnits === null) {
        continue;
      }

      running.keyInUnits += cell.keyInUnits;
      running.hmsEntered += 1;
    }
  }

  return weeks.map((week) => {
    const running = totals.get(week.weekId) ?? { keyInUnits: 0, hmsEntered: 0 };
    const isEntered = running.hmsEntered > 0;

    return {
      weekId: week.weekId,
      weekNumber: week.weekNumber,
      weekLabel: week.weekLabel,
      startDate: week.startDate,
      endDate: week.endDate,
      keyInUnits: running.keyInUnits,
      hmsEntered: running.hmsEntered,
      isEntered,
      // `null`, not the 0, for an unentered week - the band function is what
      // decides that blank is neutral, and it can only do that if it is told
      // the week is blank.
      status: weeklyKeyInStatus(isEntered ? running.keyInUnits : null),
    };
  });
}

// -----------------------------------------------------------------------------
// The group month
// -----------------------------------------------------------------------------

export type GroupMonthlyCalculatedPerformance = {
  month: MonthInput;

  /** SUM of every HM weekly Key-In. There is no keyed monthly Key-In field. */
  totalKeyIn: number;
  totalNet: number;
  totalTarget: number;
  /** Total Net / Total Target x 100. `null` when no target has been set. */
  groupAchievementPct: Percentage;
  /** Total Net / Total Key-In x 100. Never the mean of HM net ratios. */
  groupNetRatioPct: Percentage;

  totalRecruitment: number;
  totalActiveHp: number;

  /**
   * Straight from `group_monthly_metrics.shi_percentage`.
   *
   * `null` when that record is missing. Never derived, never an HM average, and
   * never falls back to one.
   */
  groupShiPct: Entry;

  totalExtrade: number;
  totalNonExtrade: number;
  groupExtradePct: Percentage;
  groupNonExtradePct: Percentage;
  /** `extrade + nonExtrade - net` at group level. 0 when the splits reconcile. */
  groupSplitBalance: number;

  weeklyGroupKeyIn: GroupWeeklyKeyIn[];

  /** Every HM model the totals were built from, in display order. */
  hms: HMMonthlyCalculatedPerformance[];

  /**
   * At least one HM has a row in `hm_monthly_performance` for this month.
   *
   * The test for "this month exists as data". A month row can be opened weeks
   * before anybody keys anything into it, and the totals of such a month are
   * all real zeros - so this is what separates "August was bad" from "nobody
   * has entered August", which is the difference a month-over-month comparison
   * and an empty state both hang on.
   */
  hasAnyMonthlyRecord: boolean;

  /**
   * Anything at all recorded: a monthly row, or one week of Key-In.
   *
   * Wider than `hasAnyMonthlyRecord` on purpose. A month where the PA has keyed
   * W1 Key-In but no monthly figures yet is a month with data - a dashboard
   * that showed its empty state would be hiding numbers that exist.
   */
  hasAnyData: boolean;

  dataCompleteness: DataCompleteness;

  /** How many HMs contributed to each total, for the "270 from 2 of 4" case. */
  contributors: {
    net: number;
    target: number;
    recruitment: number;
    activeHp: number;
    extrade: number;
    nonExtrade: number;
  };
};

export type GroupMonthlyInput = {
  month: MonthInput;
  weeks: readonly SalesWeekInput[];
  hms: readonly HMMonthlyCalculatedPerformance[];
  /**
   * The eTrust group SHI for this month, or `null` when no
   * `group_monthly_metrics` row exists. Read only - this function never
   * calculates it and never substitutes for it.
   */
  groupShiPct: Entry;
};

export function calculateGroupMonthlyPerformance(
  input: GroupMonthlyInput,
): GroupMonthlyCalculatedPerformance {
  const { hms } = input;

  const net = sumEntries(hms.map((hm) => hm.netUnits));
  const target = sumEntries(hms.map((hm) => hm.targetNetUnits));
  const recruitment = sumEntries(hms.map((hm) => hm.recruitment));
  const activeHp = sumEntries(hms.map((hm) => hm.activeHp));
  const extrade = sumEntries(hms.map((hm) => hm.extradeUnits));
  const nonExtrade = sumEntries(hms.map((hm) => hm.nonExtradeUnits));

  const totalKeyIn = hms.reduce((sum, hm) => sum + hm.totalKeyIn, 0);

  return {
    month: input.month,

    totalKeyIn,
    totalNet: net.total,
    totalTarget: target.total,
    groupAchievementPct: percentageOf(net.total, target.total),
    groupNetRatioPct: netRatio(net.total, totalKeyIn),

    totalRecruitment: recruitment.total,
    totalActiveHp: activeHp.total,

    groupShiPct: input.groupShiPct,

    totalExtrade: extrade.total,
    totalNonExtrade: nonExtrade.total,
    groupExtradePct: percentageOf(extrade.total, net.total),
    groupNonExtradePct: percentageOf(nonExtrade.total, net.total),
    // Never null at group level: the three totals are always real numbers, so
    // the identity either holds or it does not.
    groupSplitBalance:
      splitBalance(net.total, extrade.total, nonExtrade.total) ?? 0,

    weeklyGroupKeyIn: calculateGroupWeeklyKeyIn(hms, input.weeks),

    hms: [...hms],

    hasAnyMonthlyRecord: hms.some((hm) => hm.presence.hasMonthlyRecord),
    hasAnyData: hms.some((hm) => hm.presence.hasAnyData),

    dataCompleteness: calculateDataCompleteness(hms, input.weeks.length),

    contributors: {
      net: net.contributors,
      target: target.contributors,
      recruitment: recruitment.contributors,
      activeHp: activeHp.contributors,
      extrade: extrade.contributors,
      nonExtrade: nonExtrade.contributors,
    },
  };
}
