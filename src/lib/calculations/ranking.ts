import type { HMMonthlyCalculatedPerformance } from "@/lib/calculations/hm";

/**
 * HM ranking.
 *
 * Ordering logic lives here and only here, so the leaderboard, the HM cards and
 * any future report cannot disagree about who is second.
 *
 * ---------------------------------------------------------------------------
 * The ordering rule
 * ---------------------------------------------------------------------------
 *   1. The chosen metric, descending. Net Units by default.
 *   2. An unavailable metric (`null`) sorts LAST, whatever the direction. An HM
 *      with no target has an unknown achievement, not the worst one, and a null
 *      that sorted as 0 would put them below someone who genuinely achieved 3%.
 *   3. Ties break on Achievement % descending - of two HMs on 71 Net, the one
 *      who did it against a bigger target is ahead. Null achievement sorts last
 *      here too, so a tied HM with no target does not jump the queue.
 *   4. Still tied: `display_order` ascending, then name, then `hmId`.
 *
 * Steps 3 and 4 exist so the order is TOTAL: given the same HMs the result is
 * byte-identical every time, on every machine, regardless of the order the
 * database happened to return rows in. Nothing here may fall back to input
 * order - PostgREST makes no promise about it, and a leaderboard that reshuffles
 * on refresh is a leaderboard nobody trusts.
 *
 * Ranks are sequential and distinct (1, 2, 3, 4). Because the tie-break is
 * total there is never a shared rank to represent, and a UI that wants to mark
 * equal figures can compare `value` on adjacent entries.
 * ---------------------------------------------------------------------------
 */

/**
 * What a ranking can be ordered by.
 *
 * The list is closed on purpose: each of these is a figure the model already
 * holds, so ranking never needs to recompute anything. Sales are always UNITS.
 */
export type RankingMetric =
  | "netUnits"
  | "keyInUnits"
  | "achievementPct"
  | "recruitment"
  | "activeHp";

export const RANKING_METRICS = [
  "netUnits",
  "keyInUnits",
  "achievementPct",
  "recruitment",
  "activeHp",
] as const satisfies readonly RankingMetric[];

export const RANKING_METRIC_LABELS: Record<RankingMetric, string> = {
  netUnits: "Net units",
  keyInUnits: "Key-In units",
  achievementPct: "Achievement %",
  recruitment: "Recruitment",
  activeHp: "Active HP",
};

export type RankedHm = {
  /** 1-based. Sequential and distinct; see the ordering rule above. */
  rank: number;
  /** The metric this ranking sorted on. `null` when it cannot be calculated. */
  value: number | null;
  performance: HMMonthlyCalculatedPerformance;
};

export type RankingOptions = {
  metric?: RankingMetric;
  /** Descending by default - the biggest figure is rank 1. */
  direction?: "desc" | "asc";
  /**
   * Drop HMs who are inactive today. Off by default, because a historical month
   * has to keep the people who worked it. A current-month leaderboard is where
   * turning this on makes sense.
   */
  activeOnly?: boolean;
};

/** The figure a metric reads off the model. `null` means not available. */
export function rankingValue(
  performance: HMMonthlyCalculatedPerformance,
  metric: RankingMetric,
): number | null {
  switch (metric) {
    case "netUnits":
      return performance.netUnits;
    case "keyInUnits":
      // Always a real number: a month with nothing entered totals a true 0.
      return performance.totalKeyIn;
    case "achievementPct":
      return performance.achievementPct;
    case "recruitment":
      return performance.recruitment;
    case "activeHp":
      return performance.activeHp;
  }
}

/** Nulls last regardless of direction; otherwise the requested order. */
function compareValues(
  a: number | null,
  b: number | null,
  direction: "desc" | "asc",
): number {
  if (a === null && b === null) {
    return 0;
  }

  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return direction === "desc" ? b - a : a - b;
}

export function calculateHmRankings(
  performances: readonly HMMonthlyCalculatedPerformance[],
  options: RankingOptions = {},
): RankedHm[] {
  const metric = options.metric ?? "netUnits";
  const direction = options.direction ?? "desc";

  const pool = options.activeOnly
    ? performances.filter((hm) => hm.isActive)
    : performances;

  const sorted = [...pool].sort((a, b) => {
    const primary = compareValues(
      rankingValue(a, metric),
      rankingValue(b, metric),
      direction,
    );

    if (primary !== 0) {
      return primary;
    }

    // Achievement always breaks ties in the same direction - the better
    // achiever is ahead - even when the primary metric was sorted ascending.
    const byAchievement = compareValues(
      a.achievementPct,
      b.achievementPct,
      "desc",
    );

    if (byAchievement !== 0) {
      return byAchievement;
    }

    if (a.displayOrder !== b.displayOrder) {
      return a.displayOrder - b.displayOrder;
    }

    const byName = a.hmName.localeCompare(b.hmName);

    // hmId last: two HMs can genuinely share a name, and the order still has to
    // be total.
    return byName !== 0 ? byName : a.hmId.localeCompare(b.hmId);
  });

  return sorted.map((performance, index) => ({
    rank: index + 1,
    value: rankingValue(performance, metric),
    performance,
  }));
}

/** Where one HM sits in a ranking, or `null` when they are not in it. */
export function findRank(
  rankings: readonly RankedHm[],
  hmId: string,
): RankedHm | null {
  return rankings.find((entry) => entry.performance.hmId === hmId) ?? null;
}
