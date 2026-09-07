import "server-only";

import { readErrorMessage } from "@/lib/errors";
import type { HpImportContext } from "@/lib/import/hp-import";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { HPImportRun, HpMonthlyReportRow } from "@/types/models";

/**
 * Read access for HP data.
 *
 * The same pattern as every other module in `lib/data/`: server-only, the
 * request-scoped client so RLS applies as the signed-in user, `Result<T>`
 * instead of throwing, and no role checks - the page guards the route, the
 * database guards the rows.
 *
 * Everything here reads `hp_monthly_report`, the view that has already joined
 * the HP and HM identities. That is what keeps the listing one query however
 * many rows are on screen: there is no per-row lookup of an HP's name or of
 * which HM owns them.
 */

// -----------------------------------------------------------------------------
// The listing
// -----------------------------------------------------------------------------

/** One page of the HP listing. Fifty rows is about two phone screens. */
export const HP_PAGE_SIZE = 50;

export type ListHpOptions = {
  monthId: string;
  /** Narrow to one HM. Undefined shows the whole group. */
  hmId?: string | null;
  /** Only HPs with Total Key-In >= 1. */
  activeOnly?: boolean;
  /** Matched against HP Name and HP Code. */
  search?: string | null;
  /** 1-based. */
  page?: number;
};

export type HpListing = {
  rows: HpMonthlyReportRow[];
  /** Rows matching the filters across every page. */
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

/**
 * Search text, reduced to what is safe to put in a PostgREST filter.
 *
 * PostgREST parses `,` `.` `(` `)` as filter syntax and `*` as its wildcard, so
 * a raw search term is not a value - it is part of the query. Rather than
 * escaping it, everything outside letters, digits, space and a couple of
 * ordinary name characters is dropped: HP names and codes are made of those,
 * and a term that loses its punctuation still finds the row.
 */
export function sanitizeHpSearch(search: string | null | undefined): string {
  return (search ?? "")
    .replace(/[^\p{L}\p{N} _/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export async function listHpMonthly(
  options: ListHpOptions,
): Promise<Result<HpListing>> {
  const supabase = await createSupabaseServerClient();

  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const from = (page - 1) * HP_PAGE_SIZE;

  let query = supabase
    .from("hp_monthly_report")
    .select("*", { count: "exact" })
    .eq("month_id", options.monthId)
    // Active first, then by name: the listing is opened to answer "who is
    // active", and burying them under an alphabetical run of inactive HPs would
    // make the answer a scrolling exercise.
    .order("is_active", { ascending: false })
    .order("hp_name", { ascending: true })
    .order("hp_code", { ascending: true })
    .range(from, from + HP_PAGE_SIZE - 1);

  if (options.hmId) {
    query = query.eq("hm_id", options.hmId);
  }

  if (options.activeOnly) {
    query = query.eq("is_active", true);
  }

  const search = sanitizeHpSearch(options.search);

  if (search !== "") {
    query = query.or(`hp_name.ilike.*${search}*,hp_code.ilike.*${search}*`);
  }

  const { data, error, count } = await query;

  if (error) {
    return err(readErrorMessage(error));
  }

  const total = count ?? 0;

  return ok({
    rows: data ?? [],
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / HP_PAGE_SIZE)),
    pageSize: HP_PAGE_SIZE,
  });
}

export type HpMonthTotalsRow = {
  /** HP rows imported for the month (and HM, when narrowed). */
  total: number;
  /** Of those, the ones with Total Key-In >= 1. */
  active: number;
};

/**
 * The month's HP counts, from the database's own summary.
 *
 * One row per HM, summed here - so the figure the listing header shows is the
 * SAME count the dashboard's Active HP KPI shows, taken from the same view
 * rather than recounted off the page of rows currently on screen. A total
 * derived from one page of fifty would say "50 active" for a month of 96.
 */
export async function getHpMonthTotals(
  monthId: string,
  hmId?: string | null,
): Promise<Result<HpMonthTotalsRow>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("hm_monthly_hp_summary")
    .select("hp_count, active_hp")
    .eq("month_id", monthId);

  if (hmId) {
    query = query.eq("hm_id", hmId);
  }

  const { data, error } = await query;

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok(
    (data ?? []).reduce<HpMonthTotalsRow>(
      (totals, row) => ({
        total: totals.total + row.hp_count,
        active: totals.active + row.active_hp,
      }),
      { total: 0, active: 0 },
    ),
  );
}

// -----------------------------------------------------------------------------
// Import
// -----------------------------------------------------------------------------

/**
 * What the importer has to know before it can validate a file.
 *
 * Two small reads rather than a lookup per row: matching 150 spreadsheet rows
 * against the HM list is a join in memory once these are here, and the HP code
 * set is what decides NEW against UPDATE without asking the database about each
 * code in turn.
 */
export async function getHpImportContext(): Promise<Result<HpImportContext>> {
  const supabase = await createSupabaseServerClient();

  const hmsResult = await supabase
    .from("hms")
    .select("id, hm_code, name")
    .order("display_order", { ascending: true });

  if (hmsResult.error) {
    return err(readErrorMessage(hmsResult.error));
  }

  const codes = await readAllHpCodes(supabase);

  if (!codes.ok) {
    return codes;
  }

  return ok({ hms: hmsResult.data ?? [], existingHpCodes: codes.data });
}

/** One page of `hps` codes. PostgREST refuses far larger pages than this. */
const HP_CODE_PAGE = 1000;

/**
 * Every HP code, paged.
 *
 * A plain `select` looks like it returns the table and does not: PostgREST caps
 * a response at its `max-rows` setting, which Supabase projects ship at 1000.
 * The HP master list grows every month and never shrinks, so it WILL pass that
 * one day - and the failure is silent. Every code past the cap would be read as
 * "not seen before", and the preview would tell the PA it was creating 400 new
 * HPs when it was updating them.
 *
 * The import itself resolves new-versus-existing in SQL and would still have
 * been correct; it is the number the PA is shown before they commit that would
 * have been wrong, which is the number this whole screen exists to be trusted
 * on.
 *
 * A few thousand short strings, a page at a time, once a month.
 */
async function readAllHpCodes(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<Result<string[]>> {
  const codes: string[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * HP_CODE_PAGE;

    const { data, error } = await supabase
      .from("hps")
      .select("hp_code")
      .order("hp_code", { ascending: true })
      .range(from, from + HP_CODE_PAGE - 1);

    if (error) {
      return err(readErrorMessage(error));
    }

    const rows = data ?? [];
    codes.push(...rows.map((row) => row.hp_code));

    // A short page is the last page. A full one might not be, so ask again.
    if (rows.length < HP_CODE_PAGE) {
      return ok(codes);
    }

    // A ceiling on the loop rather than on the data: 50 pages is 50,000 HPs,
    // far past anything this group will have, and it means a server that keeps
    // returning full pages cannot spin here forever.
    if (page >= 49) {
      return ok(codes);
    }
  }
}

/** The most recent imports for a month, newest first. For the PA's own check. */
export async function listHpImportRuns(
  monthId: string,
  limit = 5,
): Promise<Result<HPImportRun[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("hp_import_runs")
    .select("*")
    .eq("month_id", monthId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok(data ?? []);
}
