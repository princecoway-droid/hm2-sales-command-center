import type { Metadata } from "next";

import { MonthSwitcher } from "@/components/dashboard/month-switcher";
import { NoReportingMonthsState } from "@/components/dashboard/dashboard-states";
import { HmComparison } from "@/components/hm-detail/hm-comparison";
import { HmDetailHeader } from "@/components/hm-detail/hm-detail-header";
import {
  HmNoDataState,
  HmNotFoundState,
} from "@/components/hm-detail/hm-detail-states";
import { HmPrimaryPerformance } from "@/components/hm-detail/hm-primary-performance";
import { HmQtd } from "@/components/hm-detail/hm-qtd";
import { HmSalesMix } from "@/components/hm-detail/hm-sales-mix";
import { HmSecondaryKpis } from "@/components/hm-detail/hm-secondary-kpis";
import { HmWeeklyPerformance } from "@/components/hm-detail/hm-weekly-performance";
import { Alert } from "@/components/ui/alert";
import { hasRole, requirePaOrManager } from "@/lib/auth/session";
import { monthParam, parseMonthParam, type MonthResolution } from "@/lib/calendar";
import { getHmDetailData } from "@/lib/data/hm-detail";
import {
  dashboardPath,
  hmDetailPath,
  hpListingPath,
  ROUTES,
} from "@/lib/routes";
import { formatMonthLabel } from "@/lib/validation/month";
import type { DashboardNotice } from "@/lib/view-models/dashboard";
import { buildHmDetailViewModel } from "@/lib/view-models/hm-detail";
import { buildHmPerformanceViewModel } from "@/lib/view-models/monthly-performance";

export const metadata: Metadata = { title: "HM performance" };

/**
 * One HM's month.
 *
 * ---------------------------------------------------------------------------
 * What this file does, and what it refuses to do
 * ---------------------------------------------------------------------------
 * It guards, it reads the HM and the month out of the URL, it fetches once, and
 * it hands the result to the presenter. It contains no formula: Achievement,
 * Net Ratio, the Key-In total, the weekly bands, the Extrade split, the
 * month-over-month change and the quarter are all calculated in
 * `lib/calculations` and selected for display in `lib/view-models/hm-detail.ts`.
 *
 * The figures are selected out of the SAME month model the dashboard is built
 * from, so this HM's Net here and their Net on the dashboard card cannot
 * disagree - they are the same object.
 *
 * A Server Component, rendering on the server against the signed-in user's RLS.
 * Only the month switcher ships JavaScript. This route sits inside the
 * authenticated area exactly like the dashboard; there is no public HM view.
 *
 * The month lives in the URL as `?month=2026-09`, so a refresh, a bookmark and
 * a link shared in a chat all land on the same month - and switching month is a
 * navigation, which is what makes "no stale values from the previous month"
 * structural rather than something to remember.
 */
export default async function HmDetailPage(
  props: PageProps<"/hm/[hmId]">,
) {
  const user = await requirePaOrManager();
  const [{ hmId }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  const raw =
    typeof searchParams.month === "string" ? searchParams.month : undefined;
  const request = parseMonthParam(raw);

  // A parameter that was supplied but did not parse is not the same as none at
  // all: it is a broken link, and the page says so rather than quietly showing
  // a different month.
  const requestWasMalformed = raw !== undefined && request === null;

  const result = await getHmDetailData(hmId, request, { requestWasMalformed });

  const canEnterData = hasRole(user, "manager", "pa");

  if (!result.ok) {
    // The message is already the safe, mapped one - `readErrorMessage` never
    // passes a raw Postgres error through to the screen.
    console.error("[hm-detail] load failed:", result.error);

    return (
      <Alert tone="error" title="Unable to load HM performance">
        <p>{result.error}</p>
        <p className="mt-2 text-sm">
          Reload the page to try again. If it keeps happening, let your manager
          know.
        </p>
      </Alert>
    );
  }

  const today = new Date();
  const currentMonthLabel = formatMonthLabel(
    today.getFullYear(),
    today.getMonth() + 1,
  );

  if (result.data === null) {
    return (
      <NoReportingMonthsState
        currentMonthLabel={currentMonthLabel}
        canEnterData={canEnterData}
      />
    );
  }

  const { hm, months, selectedMonth, resolution, bundle, lastUpdatedAt } =
    result.data;

  // The id names nobody. A stale bookmark or a deleted record - said plainly,
  // with a way back, rather than thrown.
  if (!hm) {
    return <HmNotFoundState backHref={dashboardPath(monthParam(selectedMonth))} />;
  }

  const model = buildHmPerformanceViewModel(bundle, hm.id);

  if (!model) {
    // The selected month is missing from its own bundle - a fetch that should
    // not be able to happen, so it is reported rather than rendered around.
    return (
      <Alert tone="error" title="Unable to load HM performance">
        <p>This month could not be assembled. Reload the page to try again.</p>
      </Alert>
    );
  }

  const detail = buildHmDetailViewModel({
    selectedMonth,
    model,
    lastUpdatedAt,
    notice: noticeFor(resolution, currentMonthLabel),
    // This HM's active HPs for the month on screen. Built here, where the route
    // table lives, so the presenter stays free of URL construction - and so the
    // public view of the same model simply has none.
    hpListingHref: hpListingPath({
      month: monthParam(selectedMonth),
      hmId: hm.id,
      activeOnly: true,
    }),
  });

  return (
    <div className="space-y-4">
      <HmDetailHeader
        hm={detail.hm}
        month={detail.month}
        backHref={detail.backHref}
        updatedLabel={detail.updatedLabel}
        controls={
          <MonthSwitcher
            months={months}
            selected={selectedMonth}
            // Path only - the switcher appends `?month=` itself.
            basePath={hmDetailPath(hm.id)}
          />
        }
      />

      {detail.notice ? (
        <Alert
          tone={detail.notice.tone === "warning" ? "warning" : "info"}
          title={detail.notice.title}
        >
          <p>{detail.notice.body}</p>
        </Alert>
      ) : null}

      {detail.emptyMessage ? (
        <HmNoDataState
          message={detail.emptyMessage}
          monthLabel={detail.month.label}
          dataEntryHref={
            canEnterData ? `${ROUTES.dataEntry}?month=${selectedMonth.id}` : null
          }
        />
      ) : null}

      {/* The reading order is the same on every screen, and it is the mobile
          order: who and when, then Net against target, then the keyed-in
          figures, then the weekly detail, the mix, and finally the periods
          around this one. Nothing reflows into a different sequence on a wider
          screen - only into more columns. */}
      <HmPrimaryPerformance detail={detail} />

      <HmSecondaryKpis metrics={detail.secondary} />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HmWeeklyPerformance
            weekly={detail.weekly}
            monthLabel={detail.month.label}
          />
        </div>

        <HmSalesMix salesMix={detail.salesMix} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <HmComparison
          net={detail.previousMonthNet}
          recruitment={detail.previousMonthRecruitment}
        />

        <HmQtd qtd={detail.qtd} />
      </div>
    </div>
  );
}

/**
 * Why this screen is not showing the month that was asked for.
 *
 * The same three cases the dashboard has to explain, for the same reason: a
 * manager reading September's figures believing they are October's has been
 * misled, and the difference is this banner.
 */
function noticeFor(
  resolution: MonthResolution,
  currentMonthLabel: string,
): DashboardNotice | null {
  if (resolution.source === "invalid") {
    return {
      tone: "warning",
      title: "That month could not be opened",
      body: "The link named a reporting month that does not exist, so the most recent one is shown instead. Use the month selector to choose another.",
    };
  }

  if (resolution.source === "fallback") {
    return {
      tone: "info",
      title: `${currentMonthLabel} has not been opened yet`,
      body: "The current reporting month is not configured, so the most recent month with figures is shown. Open it in Data Entry to start recording this month.",
    };
  }

  return null;
}
