import "server-only";

import { readErrorMessage } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { HM } from "@/types/models";

/**
 * Read access for the HM master list.
 *
 * The pattern every data module follows:
 *   * server-only, using the request-scoped client, so RLS applies as the
 *     signed-in user rather than as a privileged service account;
 *   * returns `Result<T>` instead of throwing, so a page can render a degraded
 *     state when the database is unreachable;
 *   * no role checks here - the page guards the route, the database guards the
 *     rows.
 */

export type ListHmsOptions = {
  /** Omit inactive HMs. Defaults to false so management screens see everyone. */
  activeOnly?: boolean;
};

export async function listHms(
  options: ListHmsOptions = {},
): Promise<Result<HM[]>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("hms")
    .select("*")
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (options.activeOnly) {
    query = query.eq("status", "active");
  }

  const { data, error } = await query;

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok(data ?? []);
}

export async function getHmById(id: string): Promise<Result<HM | null>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("hms")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok(data);
}
