import type {
  HmMonthInput,
  SalesWeekInput,
} from "@/lib/calculations/inputs";
import {
  calculateSplitPercentages,
  isEntered,
  netRatio,
  recruitmentStatus,
  splitBalance,
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
  /** HP rows have been imported for this HM and month. */
  hasHpData: boolean;
  /**
   * Any figure at all - a monthly row, one week of Key-In, or imported HP data.
   *
   * HP data counts because a month whose Excel has been imported but whose HM
   * KPIs have not been keyed in yet is a month with figures on it; showing the
   * dashboard's empty state over the top of them would hide real numbers.
   */
  hasAnyData: boolean;
};

export type HMMonthlyCalculatedPerformance = {
  // Identity
  hmId: string;
  hmName: string;
  /** The Coway identifier. The key the HP import matches on, so it is shown. */
  hmCode: string;
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
  /**
   * HPs of this HM whose Total Key-In for the month is at least 1.
   *
   * Counted from the imported HP rows since Stage 8 - never keyed in, and never
   * read from the deprecated `hm_monthly_performance.active_hp` column. `null`
   * means no HP data has been imported for this HM and month, which is not the
   * same as 0 and is never shown as one.
   */
  activeHp: Entry;
  /** From eTrust. Never calculated, and never averaged into the group figure. */
  shiPct: Entry;

  // Extrade mix
  extradeUnits: Entry;
  extradePct: Percentage;
  nonExtradeUnits: Entry;
  nonExtradePct: Percentage;
  /**
   * `extrade + nonExtrade - totalKeyIn`. Informational only: the split is not
   * required to come to Key-In, or to Net, and no save depends on it.
   */
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

  // Both shares come off Total Key-In, never Net: Extrade and Non-Extrade are
  // independent manual figures that need not reconcile with Net at all.
  const split = calculateSplitPercentages(
    totalKeyIn,
    extradeUnits,
    nonExtradeUnits,
  );

  return {
    hmId: input.hm.hmId,
    hmName: input.hm.hmName,
    hmCode: input.hm.hmCode,
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
    // Off the input itself, not off `monthly`: an HM can have imported HPs
    // without anybody having keyed their monthly KPIs in yet.
    activeHp: input.activeHp,
    shiPct: monthly?.shiPct ?? null,

    extradeUnits,
    extradePct: split.extradePct,
    nonExtradeUnits,
    nonExtradePct: split.nonExtradePct,
    splitBalance: splitBalance(totalKeyIn, extradeUnits, nonExtradeUnits),

    weeklyPerformance,

    presence: {
      hasMonthlyRecord: monthly !== null,
      weeksConfigured: weeks.length,
      weeksEntered,
      weeksBlank: weeks.length - weeksEntered,
      hasHpData: input.activeHp !== null,
      hasAnyData:
        monthly !== null || weeksEntered > 0 || input.activeHp !== null,
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
