"use server";

import { revalidatePath } from "next/cache";

import { isManager, requireAuth } from "@/lib/auth/session";
import { mapDatabaseError } from "@/lib/errors";
import { failure, success, type ActionState } from "@/lib/result";
import { ROUTES } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  defaultWeekLabel,
  salesWeekCalendarSchema,
  type SalesWeekCalendarInput,
} from "@/lib/validation/sales-week";
import { toFieldErrors, uuid } from "@/lib/validation/utils";

/**
 * Coway's official weekly calendar.
 *
 * Not calendar weeks. Every month carries its own published periods, they are
 * frequently irregular, they cross month boundaries at both ends, and a month
 * may have four, five or six of them. Nothing in this file - or anywhere else -
 * derives a date from a week number.
 */

/**
 * Saves the whole calendar for a month in one statement.
 *
 * Deliberately not one request per row. Overlap is a property of the set, and
 * the database enforces it with a DEFERRABLE constraint trigger that fires at
 * COMMIT: sending every week in a single `upsert` means the whole reshuffle
 * lands in one transaction, so shifting W2..W5 forward by a day passes even
 * though each individual step momentarily overlaps its neighbour. Saving row by
 * row would trip that check on the first write.
 *
 * Adds and edits only. Removing a period is an explicit, separately guarded
 * action, because deleting a week cascades into the Key-In recorded against it.
 */
export async function saveSalesCalendarAction(
  payload: SalesWeekCalendarInput,
): Promise<ActionState> {
  await requireAuth();

  const parsed = salesWeekCalendarSchema.safeParse(payload);

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);

    return failure(
      fieldErrors.weeks?.[0] ??
        "Check the highlighted dates and try again.",
      fieldErrors,
    );
  }

  const { month_id, weeks } = parsed.data;

  if (weeks.length === 0) {
    return success("No weeks to save.");
  }

  const supabase = await createSupabaseServerClient();

  const rows = weeks.map((week) => ({
    month_id,
    week_number: week.week_number,
    // Blank means "use the default"; the database trigger would fill it in
    // anyway, and spelling it out here keeps the label and the number agreeing.
    week_label: week.week_label?.length
      ? week.week_label
      : defaultWeekLabel(week.week_number),
    start_date: week.start_date,
    end_date: week.end_date,
  }));

  const { error } = await supabase
    .from("sales_weeks")
    .upsert(rows, { onConflict: "month_id,week_number" });

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  revalidatePath(ROUTES.dataEntry);

  return success(
    `Sales calendar saved — ${rows.length} week${rows.length === 1 ? "" : "s"}.`,
  );
}

export type DeleteWeekOutcome = ActionState & {
  /** Set when the week still holds Key-In and the caller must decide. */
  keyInRows?: number;
};

/**
 * Removes one weekly period.
 *
 * `sales_weeks.id` cascades into `hm_weekly_performance`, and a cascade runs as
 * the table owner rather than as the caller - so it slips past the manager-only
 * delete policy on the performance table. Deleting a week that holds Key-In
 * would therefore let a PA erase performance history through a door the RLS
 * policy meant to close.
 *
 * Two guards close it: a week with Key-In is manager-only, and even a manager
 * has to pass `confirmed` after being told how many rows go with it. An empty
 * week - the mistyped-period case this is really for - deletes without ceremony.
 */
export async function deleteSalesWeekAction(
  weekId: string,
  options: { confirmed?: boolean } = {},
): Promise<DeleteWeekOutcome> {
  const user = await requireAuth();

  const id = uuid("Week").safeParse(weekId);

  if (!id.success) {
    return failure("That week could not be identified.");
  }

  const supabase = await createSupabaseServerClient();

  const { count, error: countError } = await supabase
    .from("hm_weekly_performance")
    .select("id", { count: "exact", head: true })
    .eq("week_id", id.data);

  if (countError) {
    const mapped = mapDatabaseError(countError);
    return failure(mapped.message, mapped.fieldErrors);
  }

  const keyInRows = count ?? 0;

  if (keyInRows > 0) {
    if (!isManager(user)) {
      return {
        ...failure(
          `This week already holds Key-In for ${keyInRows} HM record${keyInRows === 1 ? "" : "s"}. Only a manager can remove a week that has data. Adjust its dates instead.`,
        ),
        keyInRows,
      };
    }

    if (!options.confirmed) {
      return {
        ...failure(
          `This week holds Key-In for ${keyInRows} HM record${keyInRows === 1 ? "" : "s"}, which will be deleted with it. Confirm to continue.`,
        ),
        keyInRows,
      };
    }
  }

  const { data, error } = await supabase
    .from("sales_weeks")
    .delete()
    .eq("id", id.data)
    .select("id, week_label");

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  // RLS filters rather than raising on DELETE, so "no rows" is the shape a
  // refusal takes here.
  if (!data || data.length === 0) {
    return failure(
      "That week was not removed. It may already be gone, or you may not have permission.",
    );
  }

  revalidatePath(ROUTES.dataEntry);

  return success(`${data[0].week_label} removed.`);
}
