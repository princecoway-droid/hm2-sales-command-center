/**
 * The calculation engine.
 *
 * ---------------------------------------------------------------------------
 *   DATABASE  ->  lib/data  ->  THIS ENGINE  ->  dashboard / charts / reports
 * ---------------------------------------------------------------------------
 *
 * One import surface for every derived figure in the application. A dashboard
 * card, an HM card, a chart, a ranking, the WhatsApp report and a future mobile
 * view all read the same models from here, so there is exactly one definition
 * of Achievement, of Net Ratio, of the status bands, of the group totals.
 *
 *   import { calculateGroupMonthlyPerformance } from "@/lib/calculations";
 *
 * Everything exported is PURE: typed input, typed output, no Supabase, no
 * React, no clock, no I/O. Fetching belongs in `lib/data/`, which hands this
 * engine already-loaded rows; nothing here may reach for a database client.
 *
 * The rules that outrank convenience, restated because they are the ones that
 * get quietly broken:
 *
 *   Monthly Key-In is never stored. It is the sum of the entered weeks.
 *   Group SHI is never derived. It is read from `group_monthly_metrics`.
 *   Active HP and HM SHI are keyed in from eTrust, never calculated.
 *   Group percentages come off group totals, never off HM percentages.
 *   A figure that cannot be calculated is `null` - never NaN, Infinity or -1.
 *   Blank is not zero, in either direction.
 */

// Primitives - one figure in, one figure out.
export {
  countBlankWeeks,
  calculateSplitPercentages,
  extradePercentage,
  extradeRemainder,
  formatEntry,
  formatPercentage,
  formatSignedPercentage,
  formatSignedUnits,
  formatUnits,
  hasAnyKeyIn,
  hasRecordedData,
  isEntered,
  netRatio,
  nonExtradePercentage,
  percentageOf,
  recruitmentStatus,
  splitBalance,
  sumKeyIn,
  summariseCompleteness,
  targetAchievement,
  weeklyKeyInStatus,
  RECRUITMENT_GREEN_FROM,
  WEEKLY_KEYIN_GREEN_ABOVE,
  WEEKLY_KEYIN_YELLOW_FROM,
  type CompletenessLevel,
  type CompletenessRow,
  type CompletenessSummary,
  type Entry,
  type Percentage,
  type PerformanceStatus,
  type SplitPercentages,
} from "@/lib/calculations/performance";

// HP-level figures - the Total Key-In sum, the active threshold, the counts.
export {
  calculateHpTotalKeyIn,
  hpActiveEntry,
  indexHpActiveByHm,
  isHpActive,
  summariseHpRows,
  HP_ACTIVE_THRESHOLD,
  type HpActiveRecord,
  type HpMonthTotals,
  type HpTotalsRow,
} from "@/lib/calculations/hp";

// Normalization - database rows in, calculation inputs out.
export {
  buildHmMonthInput,
  buildHmMonthInputs,
  selectHmsForMonth,
  toHmMonthlyInput,
  toHmProfileInput,
  toMonthInput,
  toSalesWeekInput,
  EMPTY_MONTHLY_INPUT,
  type HmMonthInput,
  type HmMonthlyInput,
  type HmMonthlyRecord,
  type HmProfileInput,
  type HmWeeklyRecord,
  type MonthInput,
  type MonthRecords,
  type SalesWeekInput,
} from "@/lib/calculations/inputs";

// The HM model.
export {
  calculateHmMonthlyPerformance,
  calculateHmMonthlyPerformances,
  calculateWeeklyPerformance,
  type HMMonthlyCalculatedPerformance,
  type HmDataPresence,
  type WeeklyKeyInPerformance,
} from "@/lib/calculations/hm";

// KPI status - the Stage 9 pacing bands. Thresholds live here and nowhere else.
export {
  cumulativeKeyIn,
  getActiveHpStatus,
  getHmKpiStatuses,
  getHmKpiStatusesForMonth,
  getKeyInStatus,
  getManagementAttention,
  getNetStatus,
  getRecruitmentStatus,
  hasKeyInThreshold,
  keyInAchievement,
  keyInThresholdFor,
  kpiStatusMap,
  needsAttention,
  resolveCurrentWeek,
  ACTIVE_HP_THRESHOLD,
  HM_KPI_KEYS,
  KEYIN_WEEK_THRESHOLDS,
  KPI_STATUSES,
  NET_RATIO_THRESHOLD,
  RECRUITMENT_THRESHOLD,
  type CurrentWeekResolution,
  type CurrentWeekSource,
  type HmKpiKey,
  type HmKpiStatuses,
  type KeyInKpiStatus,
  type KeyInWeekThreshold,
  type KpiStatus,
  type ManagementAttentionEntry,
  type WeeklyKeyInKpiStatus,
} from "@/lib/calculations/kpi-status";

// The group model.
export {
  calculateDataCompleteness,
  calculateGroupMonthlyPerformance,
  calculateGroupWeeklyKeyIn,
  type DataCompleteness,
  type GroupMonthlyCalculatedPerformance,
  type GroupMonthlyInput,
  type GroupTotal,
  type GroupWeeklyKeyIn,
} from "@/lib/calculations/group";

// Period comparisons.
export {
  calculateMetricMonthComparison,
  calculatePreviousMonthComparison,
  calculateQtdPerformance,
  firstMonthOfQuarter,
  monthsRequiredFor,
  previousYearMonth,
  quarterMonthsToDate,
  quarterOf,
  sameYearMonth,
  type MetricMonthOverMonth,
  type MonthOverMonthComparison,
  type QtdMonthContribution,
  type QtdPerformance,
  type YearMonth,
} from "@/lib/calculations/comparison";

// Ranking.
export {
  calculateHmRankings,
  findRank,
  rankingValue,
  RANKING_METRICS,
  RANKING_METRIC_LABELS,
  type RankedHm,
  type RankingMetric,
  type RankingOptions,
} from "@/lib/calculations/ranking";
