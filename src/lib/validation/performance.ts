import { z } from "zod";

import {
  naturalNumber,
  percentage,
  uuid,
} from "@/lib/validation/utils";

/**
 * Performance schemas.
 *
 * ---------------------------------------------------------------------------
 * Extrade and Non-Extrade
 * ---------------------------------------------------------------------------
 * Two INDEPENDENT manual figures. The PA keys each one in freely: they are not
 * required to add up to Net, nor to Total Key-In, nor to each other, and no
 * schema here may refuse a record on that basis. Each is range-checked as an
 * ordinary unit count - negatives and fractions are still rejected - and that
 * is the whole of the rule.
 *
 * Their only defined relationship is for display, and it lives in
 * `lib/calculations`:
 *
 *   Extrade %      = extrade_units     / TOTAL KEY-IN x 100
 *   Non-Extrade %  = non_extrade_units / TOTAL KEY-IN x 100
 *
 * The denominator is Total Key-In, never Net.
 * ---------------------------------------------------------------------------
 *
 * Every shape is still two schemas:
 *
 *   `*DraftSchema`  what a half-filled form is allowed to look like. Fields may
 *                   be blank; ranges are still checked so bad numbers are caught
 *                   early. Never written to the database.
 *
 *   `*Schema`       what a save must satisfy - every field present and in range.
 *                   This is the only schema a mutation is allowed to use.
 *
 * Two things deliberately absent, per the reporting rules:
 *   * No extrade/non-extrade percentages - those are computed for display.
 *   * No monthly Key-In field - the monthly total is SUM(weekly Key-In).
 */

// -----------------------------------------------------------------------------
// HM monthly performance
// -----------------------------------------------------------------------------

const monthlyPerformanceFields = {
  hm_id: uuid("HM"),
  month_id: uuid("Month"),
  net_units: naturalNumber("Net units"),
  target_net_units: naturalNumber("Target net units"),
  recruitment: naturalNumber("Recruitment"),
  active_hp: naturalNumber("Active HP"),
  /** Keyed in from Coway eTrust. Never calculated, never averaged. */
  shi_percentage: percentage("SHI"),
  extrade_units: naturalNumber("Extrade units"),
  non_extrade_units: naturalNumber("Non-Extrade units"),
};

export const hmMonthlyPerformanceSchema = z.object(monthlyPerformanceFields);

export type HMMonthlyPerformanceInput = z.infer<
  typeof hmMonthlyPerformanceSchema
>;

/** In-progress form state. The same range rules, on fields that may be absent. */
export const hmMonthlyPerformanceDraftSchema = z
  .object(monthlyPerformanceFields)
  .partial();

export type HMMonthlyPerformanceDraft = z.infer<
  typeof hmMonthlyPerformanceDraftSchema
>;

// -----------------------------------------------------------------------------
// HM weekly performance
// -----------------------------------------------------------------------------

export const hmWeeklyPerformanceSchema = z.object({
  hm_id: uuid("HM"),
  week_id: uuid("Week"),
  keyin_units: naturalNumber("Key-In units"),
});

export type HMWeeklyPerformanceInput = z.infer<
  typeof hmWeeklyPerformanceSchema
>;

export const hmWeeklyPerformanceDraftSchema =
  hmWeeklyPerformanceSchema.partial();

export type HMWeeklyPerformanceDraft = z.infer<
  typeof hmWeeklyPerformanceDraftSchema
>;

// -----------------------------------------------------------------------------
// Group monthly metrics
// -----------------------------------------------------------------------------

/**
 * Group SHI, keyed in directly from eTrust.
 *
 * The only group figure that is stored. Total Key-In, total Net, Recruitment,
 * Active HP, Target, Achievement and Net Ratio are all calculated from the HM
 * and week rows, and group SHI is never derived from HM SHI.
 */
export const groupMonthlyMetricsSchema = z.object({
  month_id: uuid("Month"),
  shi_percentage: percentage("Group SHI"),
});

export type GroupMonthlyMetricsInput = z.infer<
  typeof groupMonthlyMetricsSchema
>;
