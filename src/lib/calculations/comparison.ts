import type { Percentage } from "@/lib/calculations/performance";

/**
 * Period comparisons: month-over-month, and quarter-to-date.
 *
 * Both are calculated in REPORTING MONTHS, never in calendar days. "Quarter to
 * date" on 4 September means July + August + September, not the 66 days that
 * have elapsed - a Coway sales week routinely starts in the previous calendar
 * month, so a day-based cut would slice a week in half and report a total
 * nobody can reconcile against eTrust.
 */

// -----------------------------------------------------------------------------
// Calendar arithmetic on reporting months
// -----------------------------------------------------------------------------

/** A reporting month as year + 1-12 month. The engine key for everything here. */
export type YearMonth = {
  year: number;
  month: number;
};

export function sameYearMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

/** Jan-Mar 1, Apr-Jun 2, Jul-Sep 3, Oct-Dec 4. Matches the database rule. */
export function quarterOf(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

/** The first calendar month of the quarter a month falls in: Sep -> 7, Jan -> 1. */
export function firstMonthOfQuarter(month: number): number {
  return (quarterOf(month) - 1) * 3 + 1;
}

/**
 * The immediately preceding calendar month.
 *
 * September 2026 -> August 2026. January 2027 -> December 2026. This is plain
 * calendar arithmetic and says nothing about whether that month exists in the
 * database - the bundle may simply not contain it, which is what
 * `MonthOverMonthComparison.hasPreviousMonthData` reports.
 */
export function previousYearMonth({ year, month }: YearMonth): YearMonth {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

/**
 * The months of the quarter up to and including the one selected.
 *
 * September 2026 -> July, August, September.
 * August 2026    -> July, August.
 * January 2027   -> January.
 *
 * Future months of the quarter are never included: on 4 September there is no
 * October data and inventing an empty October would drag every quarter average
 * downwards.
 */
export function quarterMonthsToDate({ year, month }: YearMonth): YearMonth[] {
  const first = firstMonthOfQuarter(month);
  const months: YearMonth[] = [];

  for (let m = first; m <= month; m += 1) {
    months.push({ year, month: m });
  }

  return months;
}

/**
 * Every reporting month a dashboard for `selected` has to read.
 *
 * The selected month, the immediately previous calendar month, and the quarter
 * to date. Those overlap - in the second month of a quarter the previous month
 * is already inside it - so the set is de-duplicated, which is what keeps the
 * fetch to a fixed handful of months instead of one per thing that needs one.
 *
 * Pure period arithmetic: it says which months are WANTED, not which exist. A
 * month that comes back missing is reported as missing, never as zero.
 */
export function monthsRequiredFor(selected: YearMonth): YearMonth[] {
  const wanted = [
    selected,
    previousYearMonth(selected),
    ...quarterMonthsToDate(selected),
  ];

  const seen = new Set<string>();

  return wanted.filter((entry) => {
    const key = `${entry.year}-${entry.month}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

// -----------------------------------------------------------------------------
// Month over month
// -----------------------------------------------------------------------------

/**
 * Current against the immediately previous month.
 *
 * A structured model rather than a formatted string, so the dashboard, a chart
 * and a report can each present the same comparison their own way.
 *
 * Three distinct outcomes, and collapsing any two of them would mislead:
 *
 *   previous month has data     everything populated
 *   previous month is 0         `differenceUnits` is the full current figure,
 *                               `percentageChange` is null - there is no
 *                               percentage increase from nothing
 *   previous month is absent    `hasPreviousMonthData` false and both derived
 *                               figures null. "No August record" is not "August
 *                               was zero", and treating it as zero would report
 *                               a triumphant +100% for a month nobody keyed in
 */
/**
 * One figure, current month against the immediately previous one.
 *
 * Metric-agnostic on purpose. Net is not the only thing a month gets compared
 * on - recruitment is asked the same question on the HM detail screen - and the
 * three outcomes below are properties of the COMPARISON, not of the figure, so
 * defining them twice is how two surfaces come to disagree about what "no
 * previous month" looks like.
 *
 * Three distinct outcomes, and collapsing any two of them would mislead:
 *
 *   previous month has data     everything populated
 *   previous month is 0         `differenceUnits` is the full current figure,
 *                               `percentageChange` is null - there is no
 *                               percentage increase from nothing
 *   previous month is absent    `hasPreviousMonthData` false and both derived
 *                               figures null. "No August record" is not "August
 *                               was zero", and treating it as zero would report
 *                               a triumphant +100% for a month nobody keyed in
 */
export type MetricMonthOverMonth = {
  currentValue: number;
  /** `null` when there is no previous month record at all. */
  previousValue: number | null;
  /** current - previous. `null` only when there is no previous month. */
  differenceUnits: number | null;
  /** `null` when the previous month is absent, or was 0. Never Infinity. */
  percentageChange: Percentage;
  hasPreviousMonthData: boolean;
  /**
   * False when the CURRENT month has no record either.
   *
   * Group totals always have data in this sense - a sum of nothing is a real 0
   * - but a single HM with no monthly row has not sold zero, they have not been
   * keyed in, and reporting them as down 100% on last month would be a
   * conclusion the data does not support.
   */
  hasCurrentMonthData: boolean;
  /** Which month was compared against, when one was found. */
  previousMonth: YearMonth | null;
};

/**
 * The Net comparison.
 *
 * Exactly the metric comparison above, with the two figures also readable under
 * their Net names. Both readings are kept deliberately: the dashboard has said
 * `previousNetUnits` since Stage 3 and renaming it would touch working code for
 * no gain, while `currentValue` / `previousValue` are what let one presenter
 * format a Net comparison and a recruitment comparison the same way.
 */
export type MonthOverMonthComparison = MetricMonthOverMonth & {
  currentNetUnits: number;
  /** `null` when there is no previous month record at all. */
  previousNetUnits: number | null;
};

export function calculateMetricMonthComparison(
  currentValue: number,
  previous: { value: number; month: YearMonth } | null,
  options: { hasCurrentData?: boolean } = {},
): MetricMonthOverMonth {
  const hasCurrentMonthData = options.hasCurrentData ?? true;

  if (previous === null || !hasCurrentMonthData) {
    return {
      currentValue,
      previousValue: previous?.value ?? null,
      differenceUnits: null,
      percentageChange: null,
      hasPreviousMonthData: previous !== null,
      hasCurrentMonthData,
      previousMonth: previous?.month ?? null,
    };
  }

  const differenceUnits = currentValue - previous.value;

  return {
    currentValue,
    previousValue: previous.value,
    differenceUnits,
    // A real zero baseline: the unit difference is still meaningful and is kept,
    // but a percentage of zero is undefined, so it stays null rather than
    // becoming Infinity.
    percentageChange:
      previous.value === 0 ? null : (differenceUnits / previous.value) * 100,
    hasPreviousMonthData: true,
    hasCurrentMonthData: true,
    previousMonth: previous.month,
  };
}

export function calculatePreviousMonthComparison(
  currentNetUnits: number,
  previous: { netUnits: number; month: YearMonth } | null,
  options: { hasCurrentData?: boolean } = {},
): MonthOverMonthComparison {
  const comparison = calculateMetricMonthComparison(
    currentNetUnits,
    previous === null ? null : { value: previous.netUnits, month: previous.month },
    options,
  );

  return {
    ...comparison,
    currentNetUnits: comparison.currentValue,
    previousNetUnits: comparison.previousValue,
  };
}

// -----------------------------------------------------------------------------
// Quarter to date
// -----------------------------------------------------------------------------

/** One month of the quarter, as it contributes to the QTD totals. */
export type QtdMonthContribution = {
  month: YearMonth;
  /** False when the month has no performance record yet. */
  hasData: boolean;
  netUnits: number;
  recruitment: number;
};

/**
 * Quarter to date.
 *
 * The numeric totals and the completeness flag are deliberately independent.
 * On 4 September the quarter runs July + August + September; July and August
 * are final, September has four days in it. The honest answer is "220 so far,
 * and the quarter is not complete", so `netUnits` sums what exists and
 * `isComplete` says whether every month of the quarter to date has a record.
 *
 * A month with no record contributes nothing and is named in `missingMonths`.
 * It is never counted as a zero month: that would be indistinguishable from a
 * genuinely terrible July.
 */
export type QtdPerformance = {
  year: number;
  quarter: number;
  /** Months from the start of the quarter through the selected month. */
  monthsToDate: YearMonth[];
  months: QtdMonthContribution[];
  monthsWithData: number;
  /** Months of the quarter to date with no performance record at all. */
  missingMonths: YearMonth[];
  /** SUM of Net across the months that have data. */
  netUnits: number;
  /** SUM of monthly recruitment. New recruitment only, never carried forward. */
  recruitment: number;
  /** True when every month of the quarter to date has a record. Not "the quarter has ended". */
  isComplete: boolean;
};

export function calculateQtdPerformance(
  selected: YearMonth,
  contributions: readonly QtdMonthContribution[],
): QtdPerformance {
  const monthsToDate = quarterMonthsToDate(selected);

  // Driven by the quarter calendar, not by what was handed in: a month the
  // caller could not find has to show up as missing rather than disappear.
  const months = monthsToDate.map((month) => {
    const found = contributions.find((entry) =>
      sameYearMonth(entry.month, month),
    );

    return (
      found ?? { month, hasData: false, netUnits: 0, recruitment: 0 }
    );
  });

  const withData = months.filter((entry) => entry.hasData);

  return {
    year: selected.year,
    quarter: quarterOf(selected.month),
    monthsToDate,
    months,
    monthsWithData: withData.length,
    missingMonths: months
      .filter((entry) => !entry.hasData)
      .map((entry) => entry.month),
    netUnits: withData.reduce((sum, entry) => sum + entry.netUnits, 0),
    recruitment: withData.reduce((sum, entry) => sum + entry.recruitment, 0),
    isComplete: withData.length === monthsToDate.length,
  };
}
