import "server-only";

import { readErrorMessage } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  GroupMonthlyMetrics,
  HM,
  HMMonthlyPerformance,
  HMWeeklyPerformance,
  Month,
  SalesWeek,
} from "@/types/models";

/**
 * Everything the data-entry screen needs for one month, in one place.
 *
 * The grid is a single editable surface over five tables, so loading it a table
 * at a time from inside components would mean a request per section and a real
 * risk of one section showing September while another still shows August. This
 * module fetches the whole month up front, scoped to a single `month_id`, and
 * the page passes it down as one object - which is also what makes switching
 * months a plain navigation rather than a cache-invalidation problem.
 */

export type MonthWorkbook = {
  month: Month;
  /** However many periods the PA configured. Never assume four, or any at all. */
  weeks: SalesWeek[];
  /**
   * Active HMs, plus any inactive HM that already has data for this month.
   *
   * Deactivating someone must not make their history disappear from the month
   * they worked, so a historical month still lists them; the current month
   * shows only the people who are actually working it.
   */
  hms: HM[];
  /**
   * HM ids that appear only because they have history here.
   *
   * An array rather than a Set: this crosses the server/client boundary, and a
   * plain array is the shape every serializer agrees on.
   */
  inactiveWithHistory: string[];
  monthly: HMMonthlyPerformance[];
  weekly: HMWeeklyPerformance[];
  groupMetrics: GroupMonthlyMetrics | null;
};

export async function getMonthWorkbook(
  monthId: string,
): Promise<Result<MonthWorkbook>> {
  const supabase = await createSupabaseServerClient();

  const [monthResult, weeksResult, hmsResult, monthlyResult, groupResult] =
    await Promise.all([
      supabase.from("months").select("*").eq("id", monthId).maybeSingle(),
      supabase
        .from("sales_weeks")
        .select("*")
        .eq("month_id", monthId)
        .order("week_number", { ascending: true }),
      supabase
        .from("hms")
        .select("*")
        .order("display_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("hm_monthly_performance")
        .select("*")
        .eq("month_id", monthId),
      supabase
        .from("group_monthly_metrics")
        .select("*")
        .eq("month_id", monthId)
        .maybeSingle(),
    ]);

  for (const result of [
    monthResult,
    weeksResult,
    hmsResult,
    monthlyResult,
    groupResult,
  ]) {
    if (result.error) {
      return err(readErrorMessage(result.error));
    }
  }

  if (!monthResult.data) {
    return err("That reporting month no longer exists.");
  }

  const weeks = weeksResult.data ?? [];
  const monthly = monthlyResult.data ?? [];
  const allHms = hmsResult.data ?? [];

  // Weekly Key-In is keyed by week, not by month, so it can only be fetched
  // once the month's week ids are known. Skipping the query entirely when the
  // calendar is empty avoids an `in.()` that PostgREST would reject.
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

  const hmIdsWithHistory = new Set<string>([
    ...monthly.map((row) => row.hm_id),
    ...weekly.map((row) => row.hm_id),
  ]);

  const inactiveWithHistory = allHms
    .filter((hm) => hm.status !== "active" && hmIdsWithHistory.has(hm.id))
    .map((hm) => hm.id);

  const inactiveIds = new Set(inactiveWithHistory);

  const hms = allHms.filter(
    (hm) => hm.status === "active" || inactiveIds.has(hm.id),
  );

  return ok({
    month: monthResult.data,
    weeks,
    hms,
    inactiveWithHistory,
    monthly,
    weekly,
    groupMetrics: groupResult.data ?? null,
  });
}
