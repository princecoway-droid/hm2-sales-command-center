import "server-only";

import { monthsRequiredFor } from "@/lib/calculations";
import {
  resolveDashboardMonth,
  type MonthRequest,
  type MonthResolution,
} from "@/lib/calendar";
import { readErrorMessage } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  MonthPerformanceRecords,
  PerformanceBundle,
} from "@/lib/view-models/monthly-performance";
import type {
  HMMonthlyPerformance,
  HMWeeklyPerformance,
  Month,
  SalesWeek,
} from "@/types/models";

/**
 * Everything the dashboard needs, in a fixed number of queries.
 *
 * The dashboard wants the selected month, the month before it and every month
 * of the quarter to date - up to four months, each with HMs, weeks, monthly
 * figures and weekly Key-In. Fetched naively that is a query per month per
 * table, and it grows with the team.
 *
 * So it is fetched by SET instead: three round trips, six queries, whatever the
 * roster size or the position in the quarter.
 *
 *   1. months + hms                          (parallel)
 *   2. sales_weeks + hm_monthly_performance  (parallel, `in` the wanted months)
 *      + group_monthly_metrics               (selected month only)
 *   3. hm_weekly_performance                 (`in` every week id from step 2)
 *
 * Step 3 cannot join step 2: weekly Key-In is keyed by `week_id`, so the week
 * ids have to exist before it can be asked for. Splitting the records back out
 * per month happens in memory, which is what keeps the count fixed.
 *
 * Reads only - no writes, no service-role client, and RLS applies as the
 * signed-in user exactly as it does everywhere else in `lib/data/`.
 */

export type DashboardData = {
  /** Every reporting month, newest first, for the month selector. */
  months: Month[];
  selectedMonth: Month;
  /** Which month is on screen and why - see `resolveDashboardMonth`. */
  resolution: MonthResolution;
  bundle: PerformanceBundle;
  /**
   * The latest `updated_at` across everything stored against the selected
   * month, or `null` when nothing has been written yet.
   *
   * Deliberately the data's own timestamp rather than the time the page
   * rendered: "Updated 4 Sep, 14:32" is a fact about the figures, whereas a
   * render clock would refresh itself every time somebody looked at a month
   * nobody had touched in a fortnight.
   */
  lastUpdatedAt: string | null;
};

export async function getDashboardData(
  request: MonthRequest | null = null,
  { requestWasMalformed = false }: { requestWasMalformed?: boolean } = {},
): Promise<Result<DashboardData | null>> {
  const supabase = await createSupabaseServerClient();

  // --- 1. months + hms -------------------------------------------------------
  const [monthsResult, hmsResult] = await Promise.all([
    supabase
      .from("months")
      .select("*")
      .order("year", { ascending: false })
      .order("month", { ascending: false }),
    supabase
      .from("hms")
      .select("*")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (monthsResult.error) {
    return err(readErrorMessage(monthsResult.error));
  }

  if (hmsResult.error) {
    return err(readErrorMessage(hmsResult.error));
  }

  const months = monthsResult.data ?? [];

  if (months.length === 0) {
    // No reporting month has been opened yet. Not an error - the PA simply has
    // not started, and the page should say so rather than fall over.
    return ok(null);
  }

  // Which month, and why. The reason travels with the data so the page can say
  // "September has not been opened, this is August" rather than showing August
  // under a September heading.
  const resolution = resolveDashboardMonth(months, request, {
    requestWasMalformed,
  });

  const selectedMonth = resolution.month;

  if (!selectedMonth) {
    return ok(null);
  }

  // Which months the page needs is period arithmetic, so it lives in the pure
  // engine and is unit-tested there rather than behind a database call.
  const wanted = monthsRequiredFor({
    year: selectedMonth.year,
    month: selectedMonth.month,
  });

  const monthIds = months
    .filter((month) =>
      wanted.some(
        (entry) => entry.year === month.year && entry.month === month.month,
      ),
    )
    .map((month) => month.id);

  // --- 2. weeks + monthly figures + group SHI --------------------------------
  const [weeksResult, monthlyResult, groupResult] = await Promise.all([
    supabase
      .from("sales_weeks")
      .select("*")
      .in("month_id", monthIds)
      .order("week_number", { ascending: true }),
    supabase.from("hm_monthly_performance").select("*").in("month_id", monthIds),
    supabase
      .from("group_monthly_metrics")
      .select("*")
      .eq("month_id", selectedMonth.id)
      .maybeSingle(),
  ]);

  if (weeksResult.error) {
    return err(readErrorMessage(weeksResult.error));
  }

  if (monthlyResult.error) {
    return err(readErrorMessage(monthlyResult.error));
  }

  if (groupResult.error) {
    return err(readErrorMessage(groupResult.error));
  }

  const weeks = weeksResult.data ?? [];
  const monthly = monthlyResult.data ?? [];

  // --- 3. weekly Key-In ------------------------------------------------------
  let weekly: HMWeeklyPerformance[] = [];

  if (weeks.length > 0) {
    const { data, error } = await supabase
      .from("hm_weekly_performance")
      .select("*")
      .in(
        "week_id",
        weeks.map((week) => week.id),
      );

    if (error) {
      return err(readErrorMessage(error));
    }

    weekly = data ?? [];
  }

  return ok({
    months,
    selectedMonth,
    resolution,
    lastUpdatedAt: latestUpdate(selectedMonth.id, weeks, monthly, weekly, groupResult.data),
    bundle: {
      selectedMonthId: selectedMonth.id,
      hms: hmsResult.data ?? [],
      months: groupRecordsByMonth(months, monthIds, weeks, monthly, weekly),
      groupShiPct: groupResult.data
        ? Number(groupResult.data.shi_percentage)
        : null,
    },
  });
}

/**
 * When the SELECTED month was last written to.
 *
 * Scoped to that month on purpose: the fetch also carries the previous month
 * and the rest of the quarter, and a September dashboard stamped with the
 * moment somebody corrected a July figure would be telling the manager
 * something they did not ask about.
 *
 * ISO strings compare lexicographically, so no dates are parsed to find the
 * maximum.
 */
function latestUpdate(
  monthId: string,
  weeks: readonly SalesWeek[],
  monthly: readonly HMMonthlyPerformance[],
  weekly: readonly HMWeeklyPerformance[],
  groupMetrics: { updated_at: string } | null,
): string | null {
  const monthWeekIds = new Set(
    weeks.filter((week) => week.month_id === monthId).map((week) => week.id),
  );

  const stamps = [
    ...monthly
      .filter((row) => row.month_id === monthId)
      .map((row) => row.updated_at),
    ...weekly
      .filter((row) => monthWeekIds.has(row.week_id))
      .map((row) => row.updated_at),
    ...(groupMetrics ? [groupMetrics.updated_at] : []),
  ].filter((stamp): stamp is string => typeof stamp === "string");

  return stamps.reduce<string | null>(
    (latest, stamp) => (latest === null || stamp > latest ? stamp : latest),
    null,
  );
}

/**
 * Splits the flat result sets back out per month.
 *
 * Only months that were actually asked for get an entry. A month of the quarter
 * that has never been opened is simply absent from the bundle, which is how the
 * QTD model comes to report it as missing instead of as a zero month.
 */
function groupRecordsByMonth(
  months: readonly Month[],
  monthIds: readonly string[],
  weeks: readonly SalesWeek[],
  monthly: readonly HMMonthlyPerformance[],
  weekly: readonly HMWeeklyPerformance[],
): MonthPerformanceRecords[] {
  const wanted = new Set(monthIds);

  const weeksByMonth = new Map<string, SalesWeek[]>();
  const weekMonth = new Map<string, string>();

  for (const week of weeks) {
    weekMonth.set(week.id, week.month_id);
    weeksByMonth.set(week.month_id, [
      ...(weeksByMonth.get(week.month_id) ?? []),
      week,
    ]);
  }

  const monthlyByMonth = new Map<string, HMMonthlyPerformance[]>();

  for (const row of monthly) {
    monthlyByMonth.set(row.month_id, [
      ...(monthlyByMonth.get(row.month_id) ?? []),
      row,
    ]);
  }

  const weeklyByMonth = new Map<string, HMWeeklyPerformance[]>();

  for (const row of weekly) {
    const monthId = weekMonth.get(row.week_id);

    if (!monthId) {
      continue;
    }

    weeklyByMonth.set(monthId, [...(weeklyByMonth.get(monthId) ?? []), row]);
  }

  return months
    .filter((month) => wanted.has(month.id))
    .map((month) => ({
      month,
      weeks: weeksByMonth.get(month.id) ?? [],
      monthly: monthlyByMonth.get(month.id) ?? [],
      weekly: weeklyByMonth.get(month.id) ?? [],
    }));
}
