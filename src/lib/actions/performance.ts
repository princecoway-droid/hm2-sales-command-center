"use server";

import { revalidatePath } from "next/cache";

import { isManager, requireAuth } from "@/lib/auth/session";
import { isEntered } from "@/lib/calculations/performance";
import { mapDatabaseError } from "@/lib/errors";
import { failure, success, type ActionState } from "@/lib/result";
import { ROUTES } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  gridRowSchema,
  savePerformancePayloadSchema,
  toCellErrors,
  weeklyCellField,
  type GridCellError,
  type SavePerformancePayload,
} from "@/lib/validation/data-entry";
import type { HMMonthlyPerformanceInsert } from "@/types/models";

/**
 * Saving the spreadsheet.
 *
 * One controlled operation for the whole edited grid, not a request per
 * keystroke. Everything the PA types lives in React state until they press
 * Save; this is the only thing that writes it.
 *
 * Shape of a save:
 *
 *   1. Authorise. A Server Action is reachable by direct POST.
 *   2. Validate the payload, then every row again on its own, so a Zod issue
 *      path stays row-local and maps back onto the exact cell.
 *   3. Check every referenced week actually belongs to the selected month, and
 *      every HM exists. This is what stops a stale tab from writing September
 *      figures into August.
 *   4. Reject the whole save if anything is wrong. Nothing partial is written,
 *      the client keeps every edited value on screen, and the PA gets cell-level
 *      messages rather than a half-applied month.
 *   5. Write in three batched statements - monthly, weekly, group SHI - however
 *      many HMs there are.
 *
 * Audit columns are never sent. The Stage 1 trigger stamps created_by and
 * updated_by from auth.uid(), overwriting anything a client supplies.
 */

export type SaveGridState = ActionState & {
  /** Located precisely enough for the grid to highlight the offending input. */
  cellErrors: GridCellError[];
};

function gridFailure(
  message: string,
  cellErrors: GridCellError[] = [],
): SaveGridState {
  return { ...failure(message), cellErrors };
}

function gridSuccess(message: string): SaveGridState {
  return { ...success(message), cellErrors: [] };
}

export async function saveMonthPerformanceAction(
  payload: SavePerformancePayload,
): Promise<SaveGridState> {
  const user = await requireAuth();
  const callerIsManager = isManager(user);

  const parsed = savePerformancePayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return gridFailure(
      "Some values could not be saved. Check the highlighted cells.",
    );
  }

  const { month_id, group_shi_percentage, rows } = parsed.data;

  if (rows.length === 0 && group_shi_percentage === null) {
    return gridSuccess("Nothing to save.");
  }

  const supabase = await createSupabaseServerClient();

  // ---------------------------------------------------------------------------
  // Reference checks - the month owns the weeks, and the HMs must exist
  // ---------------------------------------------------------------------------

  const [weeksResult, hmsResult] = await Promise.all([
    supabase.from("sales_weeks").select("id").eq("month_id", month_id),
    supabase.from("hms").select("id"),
  ]);

  if (weeksResult.error) {
    const mapped = mapDatabaseError(weeksResult.error);
    return gridFailure(mapped.message);
  }

  if (hmsResult.error) {
    const mapped = mapDatabaseError(hmsResult.error);
    return gridFailure(mapped.message);
  }

  const monthWeekIds = new Set((weeksResult.data ?? []).map((week) => week.id));
  const knownHmIds = new Set((hmsResult.data ?? []).map((hm) => hm.id));

  // ---------------------------------------------------------------------------
  // Validate every row
  // ---------------------------------------------------------------------------

  const cellErrors: GridCellError[] = [];

  for (const row of rows) {
    if (!knownHmIds.has(row.hm_id)) {
      cellErrors.push({
        hmId: row.hm_id,
        field: "_row",
        message: "That HM no longer exists. Reload the page and try again.",
      });
      continue;
    }

    const rowResult = gridRowSchema.safeParse(row);

    if (!rowResult.success) {
      cellErrors.push(...toCellErrors(row.hm_id, rowResult.error));
    }

    for (const cell of row.weekly) {
      if (!monthWeekIds.has(cell.week_id)) {
        cellErrors.push({
          hmId: row.hm_id,
          field: weeklyCellField(cell.week_id),
          message:
            "That sales week is not part of the selected month. Reload the page and try again.",
        });
      }
    }
  }

  if (cellErrors.length > 0) {
    return gridFailure(
      `${cellErrors.length} value${cellErrors.length === 1 ? "" : "s"} could not be saved. Your entries are still here — fix the highlighted cells and save again.`,
      cellErrors,
    );
  }

  // ---------------------------------------------------------------------------
  // Work out what to write
  // ---------------------------------------------------------------------------

  const hmIds = rows.map((row) => row.hm_id);

  const { data: existingMonthly, error: existingMonthlyError } = await supabase
    .from("hm_monthly_performance")
    .select("hm_id")
    .eq("month_id", month_id)
    .in("hm_id", hmIds.length > 0 ? hmIds : ["00000000-0000-0000-0000-000000000000"]);

  if (existingMonthlyError) {
    const mapped = mapDatabaseError(existingMonthlyError);
    return gridFailure(mapped.message);
  }

  const hmsWithMonthlyRow = new Set(
    (existingMonthly ?? []).map((entry) => entry.hm_id),
  );

  const monthlyUpserts: HMMonthlyPerformanceInsert[] = [];

  for (const row of rows) {
    const values = {
      net_units: row.net_units ?? 0,
      target_net_units: row.target_net_units ?? 0,
      recruitment: row.recruitment ?? 0,
      active_hp: row.active_hp ?? 0,
      shi_percentage: row.shi_percentage ?? 0,
      extrade_units: row.extrade_units ?? 0,
      non_extrade_units: row.non_extrade_units ?? 0,
    };

    const isEmpty = Object.values(values).every((value) => value === 0);

    // Don't manufacture an all-zero row for an HM nobody has touched: "no row"
    // is what the completeness indicator reads as "not entered yet", and a row
    // full of zeros would quietly turn that into "entered, all zero". Once a row
    // exists it is always rewritten, so a PA can legitimately zero one out.
    if (isEmpty && !hmsWithMonthlyRow.has(row.hm_id)) {
      continue;
    }

    monthlyUpserts.push({ hm_id: row.hm_id, month_id, ...values });
  }

  // ---------------------------------------------------------------------------
  // Weekly Key-In: blank and zero are not the same thing
  // ---------------------------------------------------------------------------

  const weeklyUpserts: { hm_id: string; week_id: string; keyin_units: number }[] =
    [];
  const weeklyClears: { hm_id: string; week_id: string }[] = [];

  for (const row of rows) {
    for (const cell of row.weekly) {
      if (isEntered(cell.keyin_units)) {
        weeklyUpserts.push({
          hm_id: row.hm_id,
          week_id: cell.week_id,
          keyin_units: cell.keyin_units,
        });
      } else {
        weeklyClears.push({ hm_id: row.hm_id, week_id: cell.week_id });
      }
    }
  }

  // A blank cell that has a stored figure behind it is a removal, and removing
  // Key-In is manager-only under the Stage 1 policy. Rather than let RLS filter
  // the DELETE and silently report success, say so plainly - and point the PA at
  // the answer they almost always want, which is a recorded zero.
  const clearedWithStoredValue = await findStoredWeeklyRows(
    supabase,
    weeklyClears,
  );

  if (clearedWithStoredValue === null) {
    return gridFailure("Could not check the existing weekly figures.");
  }

  if (clearedWithStoredValue.length > 0 && !callerIsManager) {
    return gridFailure(
      "A saved weekly Key-In cannot be blanked out. Enter 0 to record a zero week, or ask a manager to remove the figure.",
      clearedWithStoredValue.map((entry) => ({
        hmId: entry.hm_id,
        field: weeklyCellField(entry.week_id),
        message:
          "This week already has a saved figure. Enter 0 for a zero week — only a manager can remove it entirely.",
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  if (monthlyUpserts.length > 0) {
    const { error } = await supabase
      .from("hm_monthly_performance")
      .upsert(monthlyUpserts, { onConflict: "hm_id,month_id" });

    if (error) {
      const mapped = mapDatabaseError(error);
      return gridFailure(mapped.message);
    }
  }

  if (weeklyUpserts.length > 0) {
    const { error } = await supabase
      .from("hm_weekly_performance")
      .upsert(weeklyUpserts, { onConflict: "hm_id,week_id" });

    if (error) {
      const mapped = mapDatabaseError(error);
      return gridFailure(mapped.message);
    }
  }

  for (const entry of clearedWithStoredValue) {
    const { error } = await supabase
      .from("hm_weekly_performance")
      .delete()
      .eq("hm_id", entry.hm_id)
      .eq("week_id", entry.week_id);

    if (error) {
      const mapped = mapDatabaseError(error);
      return gridFailure(mapped.message);
    }
  }

  if (group_shi_percentage !== null) {
    const { error } = await supabase
      .from("group_monthly_metrics")
      .upsert(
        { month_id, shi_percentage: group_shi_percentage },
        { onConflict: "month_id" },
      );

    if (error) {
      const mapped = mapDatabaseError(error);
      return gridFailure(mapped.message);
    }
  }

  revalidatePath(ROUTES.dataEntry);
  revalidatePath(ROUTES.dashboard);

  const changed = monthlyUpserts.length;

  return gridSuccess(
    changed === 0
      ? "Saved."
      : `Saved ${changed} HM record${changed === 1 ? "" : "s"}.`,
  );
}

/**
 * Which of the blanked cells actually have a row behind them.
 *
 * Returns null on a read failure so the caller can stop rather than assume
 * "nothing stored" and delete the wrong thing.
 */
async function findStoredWeeklyRows(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  cleared: readonly { hm_id: string; week_id: string }[],
): Promise<{ hm_id: string; week_id: string }[] | null> {
  if (cleared.length === 0) {
    return [];
  }

  const weekIds = [...new Set(cleared.map((entry) => entry.week_id))];
  const hmIds = [...new Set(cleared.map((entry) => entry.hm_id))];

  const { data, error } = await supabase
    .from("hm_weekly_performance")
    .select("hm_id, week_id")
    .in("week_id", weekIds)
    .in("hm_id", hmIds);

  if (error) {
    return null;
  }

  // The two `in` filters form a rectangle, so intersect the result back down to
  // the cells actually blanked.
  const clearedKeys = new Set(
    cleared.map((entry) => `${entry.hm_id}:${entry.week_id}`),
  );

  return (data ?? []).filter((row) =>
    clearedKeys.has(`${row.hm_id}:${row.week_id}`),
  );
}
