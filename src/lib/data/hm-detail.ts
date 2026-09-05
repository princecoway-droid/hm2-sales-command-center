import "server-only";

import type { MonthRequest, MonthResolution } from "@/lib/calendar";
import { getDashboardData } from "@/lib/data/dashboard";
import { err, ok, type Result } from "@/lib/result";
import type { PerformanceBundle } from "@/lib/view-models/monthly-performance";
import type { HM, Month } from "@/types/models";

/**
 * Everything the HM detail screen needs, in the same fixed number of queries.
 *
 * ---------------------------------------------------------------------------
 * Why this reads the dashboard's own bundle
 * ---------------------------------------------------------------------------
 * The obvious implementation - fetch this HM's monthly row, then their weeks,
 * then last month's row, then each month of the quarter - is a query per figure
 * and grows with the quarter. It also opens the door to the failure this stage
 * cares most about: two screens quoting different Nets for the same HM in the
 * same month, because they assembled them by different routes.
 *
 * So the HM screen asks for the SAME month bundle the dashboard does. Three
 * round trips, six queries, whatever the roster size or the position in the
 * quarter - and the HM's figures are then selected out of the very model the
 * dashboard card was built from, which is what makes them identical by
 * construction rather than by coincidence.
 *
 * Reads only, through the request-scoped client, so RLS applies as the
 * signed-in user exactly as it does everywhere else in `lib/data/`.
 */

export type HmDetailData = {
  /** The HM's master record. `null` when the id does not exist. */
  hm: HM | null;
  /** Every reporting month, newest first, for the month selector. */
  months: Month[];
  selectedMonth: Month;
  /** Which month is on screen and why - see `resolveDashboardMonth`. */
  resolution: MonthResolution;
  bundle: PerformanceBundle;
  /** When the selected month's records were last written, or `null`. */
  lastUpdatedAt: string | null;
};

export async function getHmDetailData(
  hmId: string,
  request: MonthRequest | null = null,
  { requestWasMalformed = false }: { requestWasMalformed?: boolean } = {},
): Promise<Result<HmDetailData | null>> {
  const result = await getDashboardData(request, { requestWasMalformed });

  if (!result.ok) {
    return err(result.error);
  }

  // No reporting month has been opened at all. Not an error, and not an unknown
  // HM either - there is simply no month to show them in.
  if (result.data === null) {
    return ok(null);
  }

  const { months, selectedMonth, resolution, bundle, lastUpdatedAt } =
    result.data;

  return ok({
    // The roster is already in the bundle, so identifying the HM costs no extra
    // query - and an id that is not in it is genuinely not there, rather than
    // hidden behind a lookup that could fail differently.
    hm: bundle.hms.find((entry) => entry.id === hmId) ?? null,
    months,
    selectedMonth,
    resolution,
    bundle,
    lastUpdatedAt,
  });
}
