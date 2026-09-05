import { z } from "zod";

import { isoDate, uuid } from "@/lib/validation/utils";

/**
 * A Coway official weekly sales period.
 *
 * Coway weeks are not calendar weeks: the periods are published per month and
 * are frequently irregular, so nothing here assumes 1-7 / 8-14 / 15-21, nor
 * that a month has exactly four of them. W1 through W5 (and a rare W6) are all
 * legitimate.
 */
export const salesWeekSchema = z
  .object({
    month_id: uuid("Month"),
    week_number: z.coerce
      .number({ error: "Week number must be a number." })
      .int("Week number must be a whole number.")
      .min(1, "Week number must be 1 or greater.")
      .max(6, "Week number must be 6 or less."),
    week_label: z
      .string()
      .trim()
      .max(20, "Week label must be 20 characters or fewer.")
      .optional(),
    start_date: isoDate("Start date"),
    end_date: isoDate("End date"),
  })
  .refine((week) => week.start_date <= week.end_date, {
    message: "The start date cannot be after the end date.",
    path: ["end_date"],
  })
  // Blank means "use the default": the database trigger fills in W<n>.
  .transform((week) => ({
    ...week,
    week_label: week.week_label?.length ? week.week_label : undefined,
  }));

export type SalesWeekInput = z.infer<typeof salesWeekSchema>;

/** Default label for a week number, matching the database trigger. */
export function defaultWeekLabel(weekNumber: number): string {
  return `W${weekNumber}`;
}

/**
 * Reports overlapping periods within one month.
 *
 * The fast, friendly first pass. A plain EXCLUDE constraint would reject a
 * legitimate mid-edit state - shifting W2..W5 forward by a day makes the first
 * UPDATE overlap its neighbour - so Stage 2 backs this up with a *deferred*
 * constraint trigger instead (see the stage2_sales_week_overlap migration),
 * which checks at COMMIT and so tolerates the intermediate state while still
 * guaranteeing the saved calendar is clean.
 */
export function findOverlappingWeeks(
  weeks: readonly { week_number: number; start_date: string; end_date: string }[],
): Array<[number, number]> {
  const sorted = [...weeks].sort((a, b) =>
    a.start_date.localeCompare(b.start_date),
  );
  const clashes: Array<[number, number]> = [];

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];

    if (current.start_date <= previous.end_date) {
      clashes.push([previous.week_number, current.week_number]);
    }
  }

  return clashes;
}

/** Week numbers that appear more than once, in ascending order. */
export function findDuplicateWeekNumbers(
  weeks: readonly { week_number: number }[],
): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();

  for (const week of weeks) {
    if (seen.has(week.week_number)) {
      duplicates.add(week.week_number);
    }

    seen.add(week.week_number);
  }

  return [...duplicates].sort((a, b) => a - b);
}

/**
 * One row of the weekly calendar editor.
 *
 * Same rules as `salesWeekSchema` minus `month_id`, which the editor holds once
 * for the whole table rather than repeating on every row.
 */
export const salesWeekRowSchema = z
  .object({
    week_number: z.coerce
      .number({ error: "Week number must be a number." })
      .int("Week number must be a whole number.")
      .min(1, "Week number must be 1 or greater.")
      .max(6, "Week number must be 6 or less."),
    week_label: z
      .string()
      .trim()
      .max(20, "Week label must be 20 characters or fewer.")
      .optional(),
    start_date: isoDate("Start date"),
    end_date: isoDate("End date"),
  })
  .refine((week) => week.start_date <= week.end_date, {
    message: "The end date cannot be before the start date.",
    path: ["end_date"],
  });

export type SalesWeekRowInput = z.infer<typeof salesWeekRowSchema>;

/**
 * The whole calendar for one month, validated as a set.
 *
 * Duplicates and overlaps are properties of the collection, not of any single
 * row, so they can only be caught once every period is on the table. Saving the
 * calendar in one transaction is what lets the deferred database trigger agree
 * with this check instead of tripping over a half-applied reshuffle.
 */
export const salesWeekCalendarSchema = z
  .object({
    month_id: uuid("Month"),
    weeks: z
      .array(salesWeekRowSchema)
      .max(6, "A month can have at most six sales weeks."),
  })
  .superRefine((calendar, ctx) => {
    for (const weekNumber of findDuplicateWeekNumbers(calendar.weeks)) {
      ctx.addIssue({
        code: "custom",
        message: `Week ${weekNumber} is listed more than once. Each week number can only appear once in a month.`,
        path: ["weeks"],
      });
    }

    for (const [first, second] of findOverlappingWeeks(calendar.weeks)) {
      ctx.addIssue({
        code: "custom",
        message: `Week periods cannot overlap: W${first} and W${second} cover the same dates.`,
        path: ["weeks"],
      });
    }
  });

export type SalesWeekCalendarInput = z.infer<typeof salesWeekCalendarSchema>;
