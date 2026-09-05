import "server-only";

import { readErrorMessage } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Month, SalesWeek } from "@/types/models";

/** Reporting months, newest first. */
export async function listMonths(): Promise<Result<Month[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("months")
    .select("*")
    .order("year", { ascending: false })
    .order("month", { ascending: false });

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok(data ?? []);
}

/**
 * The configured Coway weekly periods for a month, in week order.
 *
 * Returns however many are configured - four, five, or none at all if the PA
 * has not set the month up yet. Callers must not assume a count.
 */
export async function listSalesWeeks(
  monthId: string,
): Promise<Result<SalesWeek[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("sales_weeks")
    .select("*")
    .eq("month_id", monthId)
    .order("week_number", { ascending: true });

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok(data ?? []);
}

export async function getMonthById(id: string): Promise<Result<Month | null>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("months")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok(data);
}
