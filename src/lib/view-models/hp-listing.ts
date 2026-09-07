import { formatUnits } from "@/lib/calculations";
import { monthLabel, monthParam } from "@/lib/calendar";
import { hmDetailPath, hpListingPath } from "@/lib/routes";
import { quarterLabel } from "@/lib/view-models/dashboard";
import type { HpListing } from "@/lib/data/hp";
import type { HM, Month } from "@/types/models";

/**
 * The HP listing presenter.
 *
 * ---------------------------------------------------------------------------
 *   lib/data/hp  ->  THIS FILE  ->  components
 * ---------------------------------------------------------------------------
 *
 * Selection and formatting, like every other presenter here. There is one
 * derived value in the whole file and it is not derived here either: whether an
 * HP is ACTIVE comes off `hp_monthly_report.is_active`, which the database
 * computes as `total_key_in >= 1` - the same threshold `isHpActive` states in
 * the engine, enforced in the one place the count is actually taken.
 *
 * Pure: no React, no Supabase, no clock.
 */

export type HpRowModel = {
  id: string;
  hpName: string;
  hpCode: string;
  hmId: string;
  hmName: string;
  hmCode: string;
  /** That HM's own screen, on this month. */
  hmHref: string;
  /** W1-W4, already formatted. A week with no Key-In reads as 0, not a blank. */
  weekLabels: [string, string, string, string];
  totalKeyInLabel: string;
  totalNetLabel: string;
  isActive: boolean;
  statusLabel: string;
};

export type HpFilterModel = {
  /** The selected HM, or `null` for the whole group. */
  hmId: string | null;
  activeOnly: boolean;
  search: string;
  /** Every HM, for the filter control. Code included: it is how a PA thinks. */
  hms: { id: string; label: string }[];
};

export type HpPaginationModel = {
  page: number;
  pageCount: number;
  /** "Showing 1-50 of 148". Never just a page number. */
  rangeLabel: string;
  previousHref: string | null;
  nextHref: string | null;
};

export type HpListingViewModel = {
  month: {
    id: string;
    label: string;
    /** The `?month=` value. */
    param: string;
    quarterLabel: string;
  };
  rows: HpRowModel[];
  /** Matching rows across every page, and how many of them are active. */
  totalLabel: string;
  activeLabel: string;
  filters: HpFilterModel;
  pagination: HpPaginationModel;
  /** What to say when nothing matched. `null` when something did. */
  emptyMessage: string | null;
  /** Where "clear the filters" goes. `null` when nothing is filtered. */
  clearFiltersHref: string | null;
};

export type HpListingPresenterInput = {
  selectedMonth: Month;
  listing: HpListing;
  /** Active HP across the whole month, from the same count the dashboard shows. */
  activeTotal: number;
  hms: readonly HM[];
  filters: {
    hmId: string | null;
    activeOnly: boolean;
    search: string;
  };
};

export function buildHpListingViewModel({
  selectedMonth,
  listing,
  activeTotal,
  hms,
  filters,
}: HpListingPresenterInput): HpListingViewModel {
  const param = monthParam(selectedMonth);

  const linkFor = (page: number) =>
    hpListingPath({
      month: param,
      hmId: filters.hmId,
      activeOnly: filters.activeOnly,
      search: filters.search || null,
      page,
    });

  const isFiltered =
    filters.hmId !== null || filters.activeOnly || filters.search !== "";

  const first = listing.total === 0 ? 0 : (listing.page - 1) * listing.pageSize + 1;
  const last = Math.min(listing.page * listing.pageSize, listing.total);

  return {
    month: {
      id: selectedMonth.id,
      label: monthLabel(selectedMonth),
      param,
      quarterLabel: quarterLabel(selectedMonth.quarter, selectedMonth.year),
    },

    rows: listing.rows.map((row) => ({
      id: row.id,
      hpName: row.hp_name,
      hpCode: row.hp_code,
      hmId: row.hm_id,
      hmName: row.hm_name,
      hmCode: row.hm_code,
      hmHref: hmDetailPath(row.hm_id, param),
      weekLabels: [
        formatUnits(row.w1_key_in),
        formatUnits(row.w2_key_in),
        formatUnits(row.w3_key_in),
        formatUnits(row.w4_key_in),
      ],
      totalKeyInLabel: formatUnits(row.total_key_in),
      totalNetLabel: formatUnits(row.total_net),
      isActive: row.is_active,
      statusLabel: row.is_active ? "Active" : "Inactive",
    })),

    totalLabel: formatUnits(listing.total),
    activeLabel: formatUnits(activeTotal),

    filters: {
      hmId: filters.hmId,
      activeOnly: filters.activeOnly,
      search: filters.search,
      // The code is part of the label rather than a second column: a PA
      // recognises "HM10321" faster than a name, and the select has one line.
      hms: hms.map((hm) => ({
        id: hm.id,
        label: `${hm.name} · ${hm.hm_code}`,
      })),
    },

    pagination: {
      page: listing.page,
      pageCount: listing.pageCount,
      rangeLabel:
        listing.total === 0
          ? "No HP records"
          : `Showing ${first}–${last} of ${formatUnits(listing.total)}`,
      previousHref: listing.page > 1 ? linkFor(listing.page - 1) : null,
      nextHref:
        listing.page < listing.pageCount ? linkFor(listing.page + 1) : null,
    },

    emptyMessage:
      listing.rows.length > 0
        ? null
        : isFiltered
          ? "No HP matches these filters for this month."
          : "No HP data has been imported for this month yet.",

    clearFiltersHref: isFiltered ? hpListingPath({ month: param }) : null,
  };
}
