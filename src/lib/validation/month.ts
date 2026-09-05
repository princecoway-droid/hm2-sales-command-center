import { z } from "zod";

/**
 * Reporting month.
 *
 * Only year and month are ever supplied: `quarter` and `label` are derived, by
 * the database trigger on write and by the helpers below when the UI needs to
 * preview them. Keeping one derivation rule on each side, both spelled out
 * here, is what stops a Q3 month being filed under Q2.
 */
export const monthSchema = z.object({
  year: z.coerce
    .number({ error: "Year must be a number." })
    .int("Year must be a whole number.")
    .min(2000, "Year must be 2000 or later.")
    .max(2100, "Year must be 2100 or earlier."),
  month: z.coerce
    .number({ error: "Month must be a number." })
    .int("Month must be a whole number.")
    .min(1, "Month must be between 1 and 12.")
    .max(12, "Month must be between 1 and 12."),
});

export type MonthInput = z.infer<typeof monthSchema>;

/** Jan-Mar = 1, Apr-Jun = 2, Jul-Sep = 3, Oct-Dec = 4. */
export function deriveQuarter(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** e.g. `formatMonthLabel(2026, 9)` -> "September 2026". */
export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? "Unknown"} ${year}`;
}

export { MONTH_NAMES };
