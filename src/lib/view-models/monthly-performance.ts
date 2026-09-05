import {
  buildHmMonthInput,
  buildHmMonthInputs,
  calculateGroupMonthlyPerformance,
  calculateHmMonthlyPerformances,
  calculateHmMonthlyPerformance,
  calculateHmRankings,
  calculateMetricMonthComparison,
  calculatePreviousMonthComparison,
  calculateQtdPerformance,
  findRank,
  previousYearMonth,
  quarterMonthsToDate,
  sameYearMonth,
  toMonthInput,
  toSalesWeekInput,
  type Entry,
  type GroupMonthlyCalculatedPerformance,
  type HMMonthlyCalculatedPerformance,
  type MetricMonthOverMonth,
  type MonthOverMonthComparison,
  type QtdMonthContribution,
  type HmMonthlyRecord,
  type HmWeeklyRecord,
  type QtdPerformance,
  type RankedHm,
  type RankingOptions,
  type YearMonth,
} from "@/lib/calculations";
import type { HM, Month, SalesWeek } from "@/types/models";

/**
 * The aggregation layer.
 *
 *   raw database records
 *          |
 *      normalization          lib/calculations/inputs.ts
 *          |
 *      HM models              one per HM per month
 *          |
 *      group model            totals, ranking, MoM, QTD, completeness
 *
 * What comes out is dashboard-ready: a component can render every card, chart
 * and league table from it without knowing that `hm_weekly_performance` is
 * keyed by week rather than by month, or that group SHI lives in a different
 * table from everything else.
 *
 * Pure and framework-free, like the engine it sits on. `lib/data/dashboard.ts`
 * does the fetching and hands the records over; this file never queries.
 */

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

/** Everything stored against one reporting month. */
export type MonthPerformanceRecords = {
  month: Month;
  weeks: SalesWeek[];
  /**
   * The figures, not necessarily the rows.
   *
   * Typed as the engine's own record contract rather than as the full database
   * row, so a caller may hand over a projection. That is what the public share
   * route does: `resolve_share_report` returns these columns WITHOUT
   * `created_by` and `updated_by`, and the shared report is therefore built by
   * this same function - no second aggregation path, and no audit column ever
   * leaving the database.
   */
  monthly: HmMonthlyRecord[];
  weekly: HmWeeklyRecord[];
};

export type PerformanceBundle = {
  selectedMonthId: string;
  /** The full HM master list. Which of them a month covers is decided per month. */
  hms: HM[];
  /**
   * The selected month, the previous calendar month, and every month of the
   * quarter to date - whichever of them exist. A month absent here is a month
   * with no record, which is NOT the same as a month of zeros.
   */
  months: MonthPerformanceRecords[];
  /**
   * `group_monthly_metrics.shi_percentage` for the SELECTED month, or `null`
   * when that row does not exist.
   *
   * Only the selected month carries one: SHI is a headline figure, not a series
   * that gets summed or compared, so there is nothing for the other months in
   * the bundle to do with it. It is read here and passed through untouched -
   * never averaged from the HM SHI column, and never substituted when missing.
   */
  groupShiPct: Entry;
};

// -----------------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------------

export type MonthlyPerformanceViewModel = {
  group: GroupMonthlyCalculatedPerformance;
  /** Net units descending by default. See `calculateHmRankings` for the tie rule. */
  rankings: RankedHm[];
  /** Group Net against the immediately previous calendar month. */
  previousMonth: MonthOverMonthComparison;
  /** The same comparison per HM, keyed by `hmId`. */
  hmPreviousMonth: Record<string, MonthOverMonthComparison>;
  /**
   * Recruitment against the previous month, per HM, keyed by `hmId`.
   *
   * Recruitment is a monthly count, never cumulative, so "6 this month against
   * 4 last month" is a real question - and it is answered here rather than on
   * the screen that asks it, by the same comparison rules Net uses. An HM with
   * no record either month gets the same honest blank, not a 0 -> 0 flat.
   */
  hmPreviousMonthRecruitment: Record<string, MetricMonthOverMonth>;
  /** Group Net and recruitment from the first month of the quarter to here. */
  qtd: QtdPerformance;
  /** The same, per HM, keyed by `hmId`. */
  hmQtd: Record<string, QtdPerformance>;
};

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

function yearMonthOf(month: Month): YearMonth {
  return { year: month.year, month: month.month };
}

/**
 * One month of the bundle, fully calculated.
 *
 * The group SHI argument is what stops the previous month and the quarter
 * months quietly inheriting the selected month figure: they are calculated with
 * `null`, because their own eTrust value was not fetched and inventing one
 * would be worse than having none.
 */
function calculateMonth(
  records: MonthPerformanceRecords,
  hms: readonly HM[],
  groupShiPct: Entry,
): GroupMonthlyCalculatedPerformance {
  const weeks = records.weeks.map(toSalesWeekInput);

  const inputs = buildHmMonthInputs({
    hms,
    weeks: records.weeks,
    monthly: records.monthly,
    weekly: records.weekly,
  });

  return calculateGroupMonthlyPerformance({
    month: toMonthInput(records.month),
    weeks,
    hms: calculateHmMonthlyPerformances(inputs, weeks),
    groupShiPct,
  });
}

/** The month HM models, by id, for the month-over-month lookups. */
function indexHmsById(
  group: GroupMonthlyCalculatedPerformance,
): Map<string, HMMonthlyCalculatedPerformance> {
  return new Map(group.hms.map((hm) => [hm.hmId, hm] as const));
}


/**
 * One HM, this month against last.
 *
 * Shared by the group assembly below and by the single-HM model, so the
 * dashboard's month-over-month figure for an HM and the one on their own screen
 * are produced by the same call - the two cannot drift apart, and the "no
 * record either month" rule is written down once.
 */
function compareHmMonths(
  current: HMMonthlyCalculatedPerformance,
  previous: HMMonthlyCalculatedPerformance | null,
  previousTarget: YearMonth,
): { net: MonthOverMonthComparison; recruitment: MetricMonthOverMonth } {
  // A previous-month model that exists but holds no monthly row is still "no
  // data": the HM was in the month's roster, nobody keyed them in.
  const hadRecord = previous?.presence.hasMonthlyRecord === true;

  // An HM with no record THIS month has not sold zero - nobody has keyed them
  // in - so there is no comparison to draw, in either direction.
  const options = { hasCurrentData: current.presence.hasMonthlyRecord };

  return {
    net: calculatePreviousMonthComparison(
      current.netUnits ?? 0,
      hadRecord && previous
        ? { netUnits: previous.netUnits ?? 0, month: previousTarget }
        : null,
      options,
    ),
    recruitment: calculateMetricMonthComparison(
      current.recruitment ?? 0,
      hadRecord && previous
        ? { value: previous.recruitment ?? 0, month: previousTarget }
        : null,
      options,
    ),
  };
}

/**
 * The whole dashboard model for one month.
 *
 * Each month in the bundle is calculated exactly once and then read from for
 * the group figures, the previous-month comparison and the quarter - the
 * quarter routinely contains the selected month and, in the second month of a
 * quarter, the previous one too.
 */
export function buildMonthlyPerformanceViewModel(
  bundle: PerformanceBundle,
  options: { ranking?: RankingOptions } = {},
): MonthlyPerformanceViewModel | null {
  const selectedRecords = bundle.months.find(
    (entry) => entry.month.id === bundle.selectedMonthId,
  );

  // The selected month has to exist; everything else in the bundle is optional.
  if (!selectedRecords) {
    return null;
  }

  const calculated = new Map<string, GroupMonthlyCalculatedPerformance>();

  for (const records of bundle.months) {
    const isSelected = records.month.id === bundle.selectedMonthId;

    calculated.set(
      records.month.id,
      calculateMonth(records, bundle.hms, isSelected ? bundle.groupShiPct : null),
    );
  }

  const group = calculated.get(bundle.selectedMonthId);

  if (!group) {
    return null;
  }

  const selected = yearMonthOf(selectedRecords.month);
  const byYearMonth = [...calculated.values()];

  const find = (target: YearMonth) =>
    byYearMonth.find((entry) =>
      sameYearMonth({ year: entry.month.year, month: entry.month.month }, target),
    ) ?? null;

  // ---------------------------------------------------------------------------
  // Month over month
  // ---------------------------------------------------------------------------

  const previousTarget = previousYearMonth(selected);
  const previous = find(previousTarget);

  // A previous month row that exists but holds no performance records is still
  // "no data": the month was opened, nobody keyed anything in, and reporting a
  // collapse to zero against it would be wrong.
  const previousHasData = previous !== null && previous.hasAnyMonthlyRecord;

  const previousMonth = calculatePreviousMonthComparison(
    group.totalNet,
    previousHasData && previous
      ? { netUnits: previous.totalNet, month: previousTarget }
      : null,
  );

  const previousByHm = previous
    ? indexHmsById(previous)
    : new Map<string, HMMonthlyCalculatedPerformance>();

  const hmPreviousMonth: Record<string, MonthOverMonthComparison> = {};
  const hmPreviousMonthRecruitment: Record<string, MetricMonthOverMonth> = {};

  for (const hm of group.hms) {
    const compared = compareHmMonths(
      hm,
      previousByHm.get(hm.hmId) ?? null,
      previousTarget,
    );

    hmPreviousMonth[hm.hmId] = compared.net;
    hmPreviousMonthRecruitment[hm.hmId] = compared.recruitment;
  }

  // ---------------------------------------------------------------------------
  // Quarter to date
  // ---------------------------------------------------------------------------

  const quarterMonths = quarterMonthsToDate(selected);

  const groupContributions: QtdMonthContribution[] = [];
  const hmContributions = new Map<string, QtdMonthContribution[]>();

  for (const target of quarterMonths) {
    const monthGroup = find(target);

    if (!monthGroup || !monthGroup.hasAnyMonthlyRecord) {
      // Left out entirely: `calculateQtdPerformance` rebuilds the quarter from
      // the calendar and reports what is absent, rather than folding in a zero.
      continue;
    }

    groupContributions.push({
      month: target,
      hasData: true,
      netUnits: monthGroup.totalNet,
      recruitment: monthGroup.totalRecruitment,
    });

    for (const hm of monthGroup.hms) {
      if (!hm.presence.hasMonthlyRecord) {
        continue;
      }

      const entries = hmContributions.get(hm.hmId) ?? [];

      entries.push({
        month: target,
        hasData: true,
        netUnits: hm.netUnits ?? 0,
        recruitment: hm.recruitment ?? 0,
      });

      hmContributions.set(hm.hmId, entries);
    }
  }

  const hmQtd: Record<string, QtdPerformance> = {};

  for (const hm of group.hms) {
    hmQtd[hm.hmId] = calculateQtdPerformance(
      selected,
      hmContributions.get(hm.hmId) ?? [],
    );
  }

  return {
    group,
    rankings: calculateHmRankings(group.hms, options.ranking),
    previousMonth,
    hmPreviousMonth,
    hmPreviousMonthRecruitment,
    qtd: calculateQtdPerformance(selected, groupContributions),
    hmQtd,
  };
}

// -----------------------------------------------------------------------------
// One HM
// -----------------------------------------------------------------------------

/**
 * Everything the HM detail screen reasons about, for one HM and one month.
 *
 * Assembled from the SAME month model the dashboard is built from, so the Net
 * on an HM's own page and the Net on their dashboard card are literally the
 * same object - there is no second code path that could produce a different
 * figure for the same person and month.
 */
export type HmPerformanceViewModel = {
  performance: HMMonthlyCalculatedPerformance;
  /**
   * Where they sit in the month's Net ranking, or `null` when the month does
   * not cover them - see `isCoveredByMonth`. Never a made-up last place.
   */
  rank: number | null;
  /** How many HMs the ranking covers, so a rank can be shown as "3 of 12". */
  rankedOutOf: number;
  previousMonthNet: MonthOverMonthComparison;
  previousMonthRecruitment: MetricMonthOverMonth;
  qtd: QtdPerformance;
  /**
   * False when this month's figures are not about this HM at all: they are
   * inactive today and have nothing recorded for the month, so `selectHmsForMonth`
   * leaves them out of the group totals.
   *
   * Their own screen still has to work - the person exists, and a manager
   * following a link is owed "nothing was entered" rather than a dead end - so
   * the model is built for them anyway, entirely blank, and this flag says why.
   */
  isCoveredByMonth: boolean;
};

/**
 * One HM's month, fully derived.
 *
 * Returns `null` only when the HM does not exist in the roster at all, or when
 * the selected month is missing from its own bundle. Both are "not found",
 * which is a different answer from "found, nothing entered".
 */
export function buildHmPerformanceViewModel(
  bundle: PerformanceBundle,
  hmId: string,
): HmPerformanceViewModel | null {
  const hm = bundle.hms.find((entry) => entry.id === hmId);

  if (!hm) {
    return null;
  }

  const selectedRecords = bundle.months.find(
    (entry) => entry.month.id === bundle.selectedMonthId,
  );

  if (!selectedRecords) {
    return null;
  }

  const monthModel = buildMonthlyPerformanceViewModel(bundle);

  if (!monthModel) {
    return null;
  }

  const covered =
    monthModel.group.hms.find((entry) => entry.hmId === hmId) ?? null;

  if (covered) {
    const ranked = findRank(monthModel.rankings, hmId);

    return {
      performance: covered,
      rank: ranked?.rank ?? null,
      rankedOutOf: monthModel.rankings.length,
      // Read from the month model rather than recomputed, so the comparison on
      // this screen is the one the dashboard would have shown.
      previousMonthNet: monthModel.hmPreviousMonth[hmId]!,
      previousMonthRecruitment: monthModel.hmPreviousMonthRecruitment[hmId]!,
      qtd: monthModel.hmQtd[hmId]!,
      isCoveredByMonth: true,
    };
  }

  // Not covered by the month: inactive today, nothing recorded. Everything
  // below is built for this HM alone, and comes out blank rather than zero.
  const selected = yearMonthOf(selectedRecords.month);
  const previousTarget = previousYearMonth(selected);

  const modelFor = (records: MonthPerformanceRecords) =>
    calculateHmMonthlyPerformance(
      buildHmMonthInput(hm, records),
      records.weeks.map(toSalesWeekInput),
    );

  const recordsFor = (target: YearMonth) =>
    bundle.months.find((entry) =>
      sameYearMonth(yearMonthOf(entry.month), target),
    ) ?? null;

  const performance = modelFor(selectedRecords);

  const previousRecords = recordsFor(previousTarget);

  const compared = compareHmMonths(
    performance,
    previousRecords ? modelFor(previousRecords) : null,
    previousTarget,
  );

  // The quarter still counts the months this HM DID work: somebody who left in
  // August has a real July and August, and dropping them would understate the
  // quarter on the only screen that shows it per HM.
  const contributions: QtdMonthContribution[] = [];

  for (const target of quarterMonthsToDate(selected)) {
    const records = recordsFor(target);

    if (!records) {
      continue;
    }

    const monthPerformance = sameYearMonth(target, selected)
      ? performance
      : modelFor(records);

    if (!monthPerformance.presence.hasMonthlyRecord) {
      continue;
    }

    contributions.push({
      month: target,
      hasData: true,
      netUnits: monthPerformance.netUnits ?? 0,
      recruitment: monthPerformance.recruitment ?? 0,
    });
  }

  return {
    performance,
    rank: null,
    rankedOutOf: monthModel.rankings.length,
    previousMonthNet: compared.net,
    previousMonthRecruitment: compared.recruitment,
    qtd: calculateQtdPerformance(selected, contributions),
    isCoveredByMonth: false,
  };
}
