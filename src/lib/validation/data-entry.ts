import { z } from "zod";

import { uuid } from "@/lib/validation/utils";

/**
 * The spreadsheet payload.
 *
 * The grid saves a whole month in one operation, so what crosses the wire is a
 * JSON object rather than FormData. That matters for validation: the Stage 1
 * schemas use `z.coerce.number()` because a form hands everything over as a
 * string, and coercion turns `null` into `0` - exactly the distinction this
 * screen exists to preserve. The entry helpers below therefore take real
 * numbers and a real `null`, and never coerce.
 *
 * ---------------------------------------------------------------------------
 * Blank vs zero
 * ---------------------------------------------------------------------------
 * A blank weekly Key-In cell means "not entered yet"; `0` means "entered, and
 * the answer is zero". The two are saved differently - blank deletes the weekly
 * row, zero writes one - so the completeness indicator can tell a quiet week
 * from an unvisited one.
 *
 * Monthly figures have NOT NULL defaults of 0 in the database, so a blank there
 * saves as 0.
 *
 * ---------------------------------------------------------------------------
 * Extrade and Non-Extrade
 * ---------------------------------------------------------------------------
 * Two independent manual figures. They are range-checked like any other unit
 * count and nothing more: they are NOT required to add up to Net, to Total
 * Key-In, or to each other, so no rule here may reject a row on that basis.
 * Their only defined relationship is for display - each is shown as a share of
 * Total Key-In, computed in `lib/calculations`.
 * ---------------------------------------------------------------------------
 */

// -----------------------------------------------------------------------------
// Entry primitives - the nullable, non-coercing counterparts of lib/validation/utils
// -----------------------------------------------------------------------------

/** A whole number at or above zero, or `null` for "not entered". */
export const naturalEntry = (label: string) =>
  z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(0, `${label} cannot be negative.`)
    .nullable();

/** A 0-100 percentage with at most two decimals, or `null`. Matches numeric(5,2). */
export const percentageEntry = (label: string) =>
  z
    .number({ error: `${label} must be a number.` })
    .min(0, `${label} cannot be below 0.`)
    .max(100, `${label} cannot be above 100.`)
    .multipleOf(0.01, `${label} can have at most 2 decimal places.`)
    .nullable();

// -----------------------------------------------------------------------------
// One weekly Key-In cell
// -----------------------------------------------------------------------------

export const weeklyKeyInEntrySchema = z.object({
  week_id: uuid("Week"),
  keyin_units: naturalEntry("Key-In units"),
});

export type WeeklyKeyInEntry = z.infer<typeof weeklyKeyInEntrySchema>;

// -----------------------------------------------------------------------------
// One grid row
// -----------------------------------------------------------------------------

const gridRowFields = {
  hm_id: uuid("HM"),
  net_units: naturalEntry("Net units"),
  target_net_units: naturalEntry("Target"),
  recruitment: naturalEntry("Recruitment"),
  active_hp: naturalEntry("Active HP"),
  /** Keyed in from Coway eTrust. Never calculated, never averaged. */
  shi_percentage: percentageEntry("SHI"),
  extrade_units: naturalEntry("Extrade units"),
  non_extrade_units: naturalEntry("Non-Extrade units"),
  weekly: z
    .array(weeklyKeyInEntrySchema)
    .max(6, "A month can have at most six sales weeks."),
};

/**
 * A row mid-edit.
 *
 * Ranges apply - a negative target is wrong the moment it is typed.
 */
export const gridRowDraftSchema = z.object(gridRowFields);

export type GridRowDraft = z.infer<typeof gridRowDraftSchema>;

/**
 * A row on its way to the database.
 *
 * The same shape as the draft, deliberately: every rule this row has to satisfy
 * is a per-cell range rule, and those already hold mid-edit. There is no
 * cross-field identity left to add - Extrade and Non-Extrade are independent of
 * Net and of each other - so a row that is valid while being typed is valid to
 * save. The name is kept so the Server Action and the grid keep naming the
 * save-time schema explicitly.
 */
export const gridRowSchema = gridRowDraftSchema;

export type GridRow = z.infer<typeof gridRowSchema>;

// -----------------------------------------------------------------------------
// The whole grid
// -----------------------------------------------------------------------------

/**
 * The save payload for one month.
 *
 * Rows are validated at draft level here and re-checked one at a time by the
 * Server Action, so a Zod issue path stays row-local and can be mapped straight
 * back onto the cell that caused it.
 */
export const savePerformancePayloadSchema = z.object({
  month_id: uuid("Month"),
  /** Straight from eTrust. Never computed from the HM SHI column. */
  group_shi_percentage: percentageEntry("Group SHI"),
  rows: z
    .array(gridRowDraftSchema)
    .max(200, "Too many rows in one save."),
});

export type SavePerformancePayload = z.infer<
  typeof savePerformancePayloadSchema
>;

// -----------------------------------------------------------------------------
// Cell-level errors
// -----------------------------------------------------------------------------

/**
 * A validation failure located precisely enough for the grid to highlight it.
 *
 * `field` is either a monthly column name or `week:<week_id>`, which is how the
 * grid keys its inputs.
 */
export type GridCellError = {
  hmId: string;
  field: string;
  message: string;
};

/** Key for a weekly cell, shared by the grid and the Server Action. */
export function weeklyCellField(weekId: string): string {
  return `week:${weekId}`;
}

/** Flattens a row-local ZodError into cell errors for one HM. */
export function toCellErrors(
  hmId: string,
  error: z.ZodError,
): GridCellError[] {
  const seen = new Set<string>();
  const errors: GridCellError[] = [];

  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : "_row";
    const key = `${field}|${issue.message}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    errors.push({ hmId, field, message: issue.message });
  }

  return errors;
}
