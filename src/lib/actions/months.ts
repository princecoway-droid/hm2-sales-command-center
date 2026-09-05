"use server";

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth/session";
import { mapDatabaseError } from "@/lib/errors";
import { failure, success, type ActionState } from "@/lib/result";
import { ROUTES } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMonthLabel, monthSchema } from "@/lib/validation/month";
import { toFieldErrors } from "@/lib/validation/utils";

/**
 * Reporting months.
 *
 * Only year and month are ever sent. `quarter` and `label` are derived by the
 * database trigger, so the two never disagree - and the client-side
 * `deriveQuarter` / `formatMonthLabel` exist purely to preview what the trigger
 * will produce, never to supply it.
 *
 * Opening a month deliberately creates nothing else. No blank performance rows
 * are pre-created for the HM list: an HM with no row is genuinely "not entered
 * yet", which is exactly what the completeness indicator needs to be able to
 * say. Rows appear when the PA saves the grid.
 */
export async function createMonthAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAuth();

  const parsed = monthSchema.safeParse({
    year: formData.get("year"),
    month: formData.get("month"),
  });

  if (!parsed.success) {
    return failure(
      "Check the highlighted fields and try again.",
      toFieldErrors(parsed.error),
    );
  }

  const { year, month } = parsed.data;
  const supabase = await createSupabaseServerClient();

  // `label` and `quarter` are omitted on purpose - the trigger fills both.
  const { error } = await supabase.from("months").insert({ year, month });

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  revalidatePath(ROUTES.dataEntry);
  revalidatePath(ROUTES.settings);

  return success(`${formatMonthLabel(year, month)} opened.`);
}
