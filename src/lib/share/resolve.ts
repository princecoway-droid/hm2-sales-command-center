import type {
  HmMonthlyRecord,
  HmWeeklyRecord,
  HpActiveRecord,
} from "@/lib/calculations";
import { buildDashboardViewModel } from "@/lib/view-models/dashboard";
import { buildMonthlyPerformanceViewModel } from "@/lib/view-models/monthly-performance";
import {
  buildPublicShareViewModel,
  type PublicShareViewModel,
} from "@/lib/view-models/public-share";
import type { HM, Month, SalesWeek } from "@/types/models";

/**
 * From `resolve_share_report`'s JSON to a public report.
 *
 * The whole of the public read path except the round trip itself, kept pure so
 * it can be tested against a REAL payload from a REAL Postgres rather than
 * against a hand-written fixture. That matters more here than anywhere else in
 * the application: this is the seam where SQL-built jsonb meets the calculation
 * engine, and it is exactly the sort of join that a fixture agrees with and
 * production does not - a key spelled differently, a `numeric` arriving as a
 * string, an empty array coming back as `null`.
 *
 * `lib/data/share.ts` does the RPC and calls straight into this. No Supabase
 * client, no `next/headers`, no React: importable from a plain Node test.
 */

/** Exactly the shape `public.resolve_share_report` builds. Nothing else crosses. */
export type SharePayload = {
  month: Month;
  weeks: SalesWeek[];
  hms: HM[];
  monthly: HmMonthlyRecord[];
  weekly: HmWeeklyRecord[];
  /**
   * Active HP per HM: a COUNT, never HP records.
   *
   * The only HP figure a share token can produce. `hp_count` travels with it so
   * an HM with no imported HPs reads as blank rather than as zero active.
   */
  hpActive: HpActiveRecord[];
  /** `numeric` can arrive as a string depending on the driver. */
  groupShiPct: number | string | null;
  lastUpdatedAt: string | null;
};

/**
 * Narrows the RPC's `Json` to a payload, or `null`.
 *
 * Structural rather than a cast: what comes back is whatever the database sent,
 * and this is the one place it becomes a typed value. A payload with no month
 * is treated as no payload at all rather than rendered half way, and every
 * collection defaults to empty rather than to `undefined` - a month with no
 * sales weeks configured is a real state, and it has to reach the engine as an
 * empty list rather than as a crash.
 */
export function parseSharePayload(data: unknown): SharePayload | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const raw = data as Record<string, unknown>;
  const month = raw.month;

  if (
    !month ||
    typeof month !== "object" ||
    typeof (month as Month).id !== "string"
  ) {
    return null;
  }

  const shi = raw.group_shi_pct;
  const updated = raw.last_updated_at;

  return {
    month: month as Month,
    weeks: asArray<SalesWeek>(raw.weeks),
    hms: asArray<HM>(raw.hms),
    monthly: asArray<HmMonthlyRecord>(raw.monthly),
    weekly: asArray<HmWeeklyRecord>(raw.weekly),
    hpActive: asArray<HpActiveRecord>(raw.hp_active),
    groupShiPct:
      typeof shi === "number" || typeof shi === "string" ? shi : null,
    lastUpdatedAt: typeof updated === "string" ? updated : null,
  };
}

/**
 * One month of records -> the report a public viewer may see.
 *
 * The bundle holds exactly ONE month: the token's. There is no previous month
 * and no rest-of-quarter in it, so month-over-month and QTD come out empty and
 * the shared page does not show them. That is the structural half of "a share
 * link is not a database browser" - another month's data is not filtered out of
 * the view, it was never fetched.
 *
 * The two calls in the middle are the dashboard's own: the same engine
 * aggregation and the same presenter. The public model is then a projection of
 * what they produced, so the shared report cannot hold a figure the signed-in
 * dashboard would not.
 */
export function buildShareReport(
  payload: SharePayload,
): PublicShareViewModel | null {
  const performance = buildMonthlyPerformanceViewModel({
    selectedMonthId: payload.month.id,
    hms: payload.hms,
    months: [
      {
        month: payload.month,
        weeks: payload.weeks,
        monthly: payload.monthly,
        weekly: payload.weekly,
        hpActive: payload.hpActive,
      },
    ],
    groupShiPct:
      payload.groupShiPct === null ? null : Number(payload.groupShiPct),
  });

  if (!performance) {
    return null;
  }

  return buildPublicShareViewModel(
    buildDashboardViewModel({
      selectedMonth: payload.month,
      performance,
      lastUpdatedAt: payload.lastUpdatedAt,
    }),
  );
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
