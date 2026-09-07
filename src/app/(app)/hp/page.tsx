import type { Metadata } from "next";
import Link from "next/link";

import { MonthSwitcher } from "@/components/dashboard/month-switcher";
import { HpFilters } from "@/components/hp/hp-filters";
import { HpPagination } from "@/components/hp/hp-pagination";
import { HpTable } from "@/components/hp/hp-table";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePaOrManager } from "@/lib/auth/session";
import { parseMonthParam, resolveDashboardMonth } from "@/lib/calendar";
import { getHpMonthTotals, listHpMonthly, sanitizeHpSearch } from "@/lib/data/hp";
import { listHms } from "@/lib/data/hms";
import { listMonths } from "@/lib/data/months";
import { hpImportPath, ROUTES } from "@/lib/routes";
import { buildHpListingViewModel } from "@/lib/view-models/hp-listing";

export const metadata: Metadata = { title: "HP" };

/**
 * HP performance for one reporting month.
 *
 * ---------------------------------------------------------------------------
 * Read-only, and deliberately so
 * ---------------------------------------------------------------------------
 * Every figure on this page came from the PA's spreadsheet through
 * `/hp-import`. An editable cell here would be a second way in, and the next
 * import would overwrite it without anybody being told - so there is no edit
 * control on this screen at all. A correction is made in the spreadsheet and
 * re-imported, which is the workflow the PA already has.
 *
 * ---------------------------------------------------------------------------
 * The filters are the URL
 * ---------------------------------------------------------------------------
 * Month, HM, Active/All, search and page all live in the query string. That is
 * what lets the dashboard's Active HP figures link straight here with the right
 * filters already applied - the whole point of making those numbers clickable -
 * and it means a filtered view can be refreshed, bookmarked and shared.
 *
 * A Server Component. One page of rows is fetched, joined in the database by
 * `hp_monthly_report`, so a month of 150 HPs costs the same as a month of 15
 * and no row triggers a lookup of its own.
 */
export default async function HpListingPage(props: PageProps<"/hp">) {
  await requirePaOrManager();

  const searchParams = await props.searchParams;

  const readParam = (key: string): string | undefined =>
    typeof searchParams[key] === "string" ? searchParams[key] : undefined;

  const monthsResult = await listMonths();

  if (!monthsResult.ok) {
    return (
      <>
        <PageHeader title="HP" />
        <Alert tone="error" title="Could not load the reporting months">
          <p>{monthsResult.error}</p>
        </Alert>
      </>
    );
  }

  const months = monthsResult.data;
  const rawMonth = readParam("month");
  const resolution = resolveDashboardMonth(months, parseMonthParam(rawMonth), {
    requestWasMalformed: rawMonth !== undefined && parseMonthParam(rawMonth) === null,
  });

  const selectedMonth = resolution.month;

  if (!selectedMonth) {
    return (
      <>
        <PageHeader
          title="HP"
          description="HP-level performance for the selected reporting month."
        />
        <Card>
          <CardHeader title="No reporting months yet" />
          <CardBody>
            <Alert tone="info">
              <p>
                Open a reporting month in Data Entry first. HP figures are
                imported into a month, so there has to be one to import into.
              </p>
            </Alert>
          </CardBody>
        </Card>
      </>
    );
  }

  const hmId = readParam("hm") ?? null;
  // "Active only" is the default: the page exists to answer "who is active this
  // month", and it is reached from figures that mean exactly that. `?active=0`
  // is how the whole list is asked for.
  const activeParam = readParam("active");
  const activeOnly = activeParam === undefined ? true : activeParam === "1";
  const search = sanitizeHpSearch(readParam("q"));
  const page = Number.parseInt(readParam("page") ?? "1", 10);

  const [listingResult, totalsResult, hmsResult] = await Promise.all([
    listHpMonthly({
      monthId: selectedMonth.id,
      hmId,
      activeOnly,
      search,
      page: Number.isFinite(page) ? page : 1,
    }),
    getHpMonthTotals(selectedMonth.id, hmId),
    listHms(),
  ]);

  if (!listingResult.ok) {
    return (
      <>
        <PageHeader title="HP" />
        <Alert tone="error" title="Could not load the HP list">
          <p>{listingResult.error}</p>
        </Alert>
      </>
    );
  }

  const listing = buildHpListingViewModel({
    selectedMonth,
    listing: listingResult.data,
    activeTotal: totalsResult.ok ? totalsResult.data.active : 0,
    hms: hmsResult.ok ? hmsResult.data : [],
    filters: { hmId, activeOnly, search },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="HP"
        description="HP-level Key-In and Net for the selected month, imported from the PA's Excel. Read-only — corrections are made in the spreadsheet and re-imported."
        action={
          <Link
            href={hpImportPath(listing.month.param)}
            className="inline-flex min-h-11 items-center rounded-md bg-sky-700 px-3.5 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            Import Excel
          </Link>
        }
      />

      <Card>
        <CardHeader
          title={`${listing.month.label} · ${listing.activeLabel} Active HP`}
          description={
            hmId
              ? "Filtered to one HM. Active HP counts HPs whose Total Key-In is at least 1."
              : "Active HP counts HPs whose Total Key-In for the month is at least 1."
          }
          action={
            <MonthSwitcher
              months={months}
              selected={selectedMonth}
              basePath={ROUTES.hpListing}
            />
          }
        />

        <CardBody className="space-y-4">
          <HpFilters month={listing.month} filters={listing.filters} />

          {listing.emptyMessage ? (
            <Alert tone="info" title="Nothing to show">
              <p>{listing.emptyMessage}</p>
              {listing.clearFiltersHref ? (
                <p className="mt-2">
                  <Link
                    href={listing.clearFiltersHref}
                    className="font-medium text-sky-800 underline underline-offset-2"
                  >
                    Clear the filters
                  </Link>
                </p>
              ) : (
                <p className="mt-2">
                  <Link
                    href={hpImportPath(listing.month.param)}
                    className="font-medium text-sky-800 underline underline-offset-2"
                  >
                    Import the month&apos;s Excel
                  </Link>
                </p>
              )}
            </Alert>
          ) : (
            <>
              <HpTable rows={listing.rows} monthLabel={listing.month.label} />
              <HpPagination pagination={listing.pagination} />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
