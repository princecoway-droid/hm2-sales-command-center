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
 * Validation strategy for the Extrade rule
 * ---------------------------------------------------------------------------
 * `extrade_units + non_extrade_units = net_units` is a hard CHECK constraint in
 * the database, so a saved row can never break it. That constraint is unhelpful
 * mid-typing, though: a PA who sets Net to 40 before touching the split would be
 * fighting it on every keystroke if the form wrote through on change.
 *
 * So the split is two schemas over the same shape:
 *
 *   `*DraftSchema`  what a half-filled form is allowed to look like. Fields may
 *                   be blank; ranges are still checked so bad numbers are caught
 *                   early. Never written to the database.
 *
 *   `*Schema`       what a save must satisfy - every field present and the
 *                   Extrade identity holding. This is the only schema a
 *                   mutation is allowed to use.
 *
 * Drafts live in React form state, so an incomplete record never reaches
 * Postgres in the first place; the constraint is the backstop, not the
 * first line of defence.
 * ---------------------------------------------------------------------------
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

export const hmMonthlyPerformanceSchema = z
  .object(monthlyPerformanceFields)
  .superRefine((value, ctx) => {
    const total = value.extrade_units + value.non_extrade_units;

    if (total !== value.net_units) {
      const message = `Extrade (${value.extrade_units}) + Non-Extrade (${value.non_extrade_units}) = ${total}, which must equal Net Units (${value.net_units}).`;

      // Reported on both inputs so whichever one the PA is looking at shows it.
      ctx.addIssue({ code: "custom", message, path: ["extrade_units"] });
      ctx.addIssue({ code: "custom", message, path: ["non_extrade_units"] });
    }
  });

export type HMMonthlyPerformanceInput = z.infer<
  typeof hmMonthlyPerformanceSchema
>;

/** In-progress form state. Range rules apply; the Extrade identity does not. */
export const hmMonthlyPerformanceDraftSchema = z
  .object(monthlyPerformanceFields)
  .partial();

export type HMMonthlyPerformanceDraft = z.infer<
  typeof hmMonthlyPerformanceDraftSchema
>;

/** True when a draft already satisfies the Extrade identity. */
export function isExtradeSplitBalanced(
  draft: Pick<
    HMMonthlyPerformanceDraft,
    "net_units" | "extrade_units" | "non_extrade_units"
  >,
): boolean {
  const { net_units, extrade_units, non_extrade_units } = draft;

  if (
    net_units === undefined ||
    extrade_units === undefined ||
    non_extrade_units === undefined
  ) {
    return false;
  }

  return extrade_units + non_extrade_units === net_units;
}

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
