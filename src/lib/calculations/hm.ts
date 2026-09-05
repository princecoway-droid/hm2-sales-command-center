import type {
  HmMonthInput,
  SalesWeekInput,
} from "@/lib/calculations/inputs";
import {
  calculateSplitPercentages,
  isEntered,
  netRatio,
  recruitmentStatus,
  sumKeyIn,
  targetAchievement,
  weeklyKeyInStatus,
  type Entry,
  type Percentage,
  type PerformanceStatus,
} from "@/lib/calculations/performance";

/**
 * The HM monthly model.
 *
 * One HM, one month, every figure already derived. This is the shape the
 * dashboard cards, the HM cards, the ranking, the charts and the future
 * WhatsApp report all read - none of them recompute a percentage, a total or a
 * status band, so there is no way for two surfaces to disagree about what an
 * HM did in September.
 *
 * Everything is a plain serializable value, so a Server Component can build the
 * model and hand it straight to a Client Component without a second pass.
 */

// -----------------------------------------------------------------------------
// Weekly
// -----------------------------------------------------------------------------

/**
 * One configured sales week, with the Key-In that landed in it.
 *
 * The dates come from the `sales_weeks` row and are never derived: Coway weeks
 * are not calendar weeks, a month may have four, five or six of them, and W1
 * routinely starts in the previous calendar month.
 */
export type WeeklyKeyInPerformance = {
  weekId: string;
  weekNumber: number;
  weekLabel: string;
  startDate: string;
  endDate: string;
  /** `null` when nothing has been keyed in for this week. */
  keyInUnits: Entry;
  status: PerformanceStatus;
  /** False for a blank week. A blank week is incomplete, not a zero week. */
  isEntered: boolean;
};

export function calculateWeeklyPerformance(
  weeks: readonly SalesWeekInput[],
  keyInByWeekId: Readonly<Record<string, number>>,
): WeeklyKeyInPerformance[] {
  return weeks.map((week) => {
    const raw = keyInByWeekId[week.weekId];
    const keyInUnits: Entry = raw === undefined ? null : raw;

    return {
      weekId: week.weekId,
      weekNumber: week.weekNumber,
      weekLabel: week.weekLabel,
      startDate: week.startDate,
      endDate: week.endDate,
      keyInUnits,
      status: weeklyKeyInStatus(keyInUnits),
      isEntered: isEntered(keyInUnits),
    };
  });
}

// -----------------------------------------------------------------------------
// The month
// -----------------------------------------------------------------------------

/**
 * Whether an HM month has been keyed in, kept separate from the figures.
 *
 * `hasMonthlyRecord` and the weekly counts are deliberately two different
 * things. A month in progress legitimately has blank weeks - it is the 4th and
 * W2 has not happened yet - so weekly blanks must never make the month read as
 * unfilled. Only the absence of the monthly row means "the PA has not been
 * here".
 */
export type HmDataPresence = {
  /** A row exists in `hm_monthly_performance` for this HM and month. */
  hasMonthlyRecord: boolean;
  /** Weeks configured for the month. Zero means the calendar is not set up. */
  weeksConfigured: number;
  weeksEntered: number;
  weeksBlank: number;
  /** Any figure at all - a monthly row, or one week of Key-In. */
  hasAnyData: boolean;
};

export type HMMonthlyCalculatedPerformance = {
  // Identity
  hmId: string;
  hmName: string;
  office: string;
  photoUrl: string | null;
  /**
   * `hms.status` today. False here on a historical month means the HM has since
   * left; their figures are still counted, because those units were sold.
   */
  isActive: boolean;
  displayOrder: number;

  // Sales, all in units
  /** SUM of the entered weeks. Never a stored column, never a blank-as-zero. */
  totalKeyIn: number;
  netUnits: Entry;
  targetNetUnits: Entry;
  /** Net / Target x 100. `null` when the target is 0 or either side is blank. */
  achievementPct: Percentage;
  /** Net / Total Key-In x 100. `null` when nothing has been keyed in. */
  netRatioPct: Percentage;

  // Manually keyed figures
  /** New recruitment for this month only. Never cumulative, never carried forward. */
  recruitment: Entry;
  recruitmentStatus: PerformanceStatus;
  /** From eTrust: HPs with at least one net sale. Never derived from sales. */
  activeHp: Entry;
  /** From eTrust. Never calculated, and never averaged into the group figure. */
  shiPct: Entry;

  // Extrade mix
  extradeUnits: Entry;
  extradePct: Percentage;
  nonExtradeUnits: Entry;
  nonExtradePct: Percentage;
  /** `extrade + nonExtrade - net`. 0 balanced, + excess, - missing. */
  splitBalance: number | null;

  // Weeks
  weeklyPerformance: WeeklyKeyInPerformance[];

  // Completeness
  presence: HmDataPresence;
};

/**
 * One HM month, fully derived.
 *
 * Pure: no database, no React, no clock. Everything it needs was resolved by
 * `buildHmMonthInputs`, which is what lets the same function serve the current
 * month, a historical month and each month of a quarter without knowing the
 * difference.
 */
export function calculateHmMonthlyPerformance(
  input: HmMonthInput,
  weeks: readonly SalesWeekInput[],
): HMMonthlyCalculatedPerformance {
  const weeklyPerformance = calculateWeeklyPerformance(
    weeks,
    input.weeklyKeyIn,
  );

  const weeklyValues = weeklyPerformance.map((week) => week.keyInUnits);
  const totalKeyIn = sumKeyIn(weeklyValues);
  const weeksEntered = weeklyPerformance.filter((week) => week.isEntered).length;

  const monthly = input.monthly;
  const netUnits = monthly?.netUnits ?? null;
  const extradeUnits = monthly?.extradeUnits ?? null;
  const nonExtradeUnits = monthly?.nonExtradeUnits ?? null;
  const recruitment = monthly?.recruitment ?? null;

  const split = calculateSplitPercentages(
    netUnits,
    extradeUnits,
    nonExtradeUnits,
  );

  return {
    hmId: input.hm.hmId,
    hmName: input.hm.hmName,
    office: input.hm.office,
    photoUrl: input.hm.photoUrl,
    isActive: input.hm.isActive,
    displayOrder: input.hm.displayOrder,

    totalKeyIn,
    netUnits,
    targetNetUnits: monthly?.targetNetUnits ?? null,
    achievementPct: targetAchievement(netUnits, monthly?.targetNetUnits ?? null),
    netRatioPct: netRatio(netUnits, totalKeyIn),

    recruitment,
    recruitmentStatus: recruitmentStatus(recruitment),
    activeHp: monthly?.activeHp ?? null,
    shiPct: monthly?.shiPct ?? null,

    extradeUnits,
    extradePct: split.extradePct,
    nonExtradeUnits,
    nonExtradePct: split.nonExtradePct,
    splitBalance: split.balance,

    weeklyPerformance,

    presence: {
      hasMonthlyRecord: monthly !== null,
      weeksConfigured: weeks.length,
      weeksEntered,
      weeksBlank: weeks.length - weeksEntered,
      hasAnyData: monthly !== null || weeksEntered > 0,
    },
  };
}

/** The whole month, HM by HM, in the order the HMs are displayed. */
export function calculateHmMonthlyPerformances(
  inputs: readonly HmMonthInput[],
  weeks: readonly SalesWeekInput[],
): HMMonthlyCalculatedPerformance[] {
  return inputs.map((input) => calculateHmMonthlyPerformance(input, weeks));
}
