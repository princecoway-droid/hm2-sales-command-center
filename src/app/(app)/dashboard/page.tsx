import type { Metadata } from "next";

import { CompletenessBanner } from "@/components/dashboard/completeness-banner";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import {
  DashboardEmptyState,
  NoReportingMonthsState,
} from "@/components/dashboard/dashboard-states";
import { GroupKpis } from "@/components/dashboard/group-kpis";
import { HmPerformance } from "@/components/dashboard/hm-performance";
import { ManagementAttention } from "@/components/dashboard/management-attention";
import { MonthSwitcher } from "@/components/dashboard/month-switcher";
import { PeriodSummary } from "@/components/dashboard/period-summary";
import { WeeklyKeyIn } from "@/components/dashboard/weekly-keyin";
import { WhatsAppReport } from "@/components/dashboard/whatsapp-report";
import { Alert } from "@/components/ui/alert";
import { hasRole, requirePaOrManager } from "@/lib/auth/session";
import { parseMonthParam } from "@/lib/calendar";
import { getDashboardData } from "@/lib/data/dashboard";
import { formatMonthLabel } from "@/lib/validation/month";
import {
  buildDashboardViewModel,
  type DashboardNotice,
} from "@/lib/view-models/dashboard";
import { buildMonthlyPerformanceViewModel } from "@/lib/view-models/monthly-performance";
import type { MonthResolution } from "@/lib/calendar";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The management command centre.
 *
 * ---------------------------------------------------------------------------
 * What this file does, and what it refuses to do
 * ---------------------------------------------------------------------------
 * It guards, it reads the month out of the URL, it fetches once, and it hands
 * the result to the presenter. It contains no formula: every figure below -
 * Achievement, Net Ratio, the group totals, the ranking, the status bands, MoM,
 * QTD - is calculated in `lib/calculations` and selected for display in
 * `lib/view-models/dashboard.ts`. If a number is wrong, it is wrong in exactly
 * one place, and that place has tests.
 *
 * A Server Component by default. The whole page renders on the server against
 * the signed-in user's RLS; only the month switcher and the refresh button ship
 * JavaScript, because only they need it.
 *
 * The month lives in the URL as `?month=2026-09`, so a refresh, a bookmark and
 * a link shared in a chat all land on the same month - and switching month is a
 * navigation, which is what makes "no stale values from the previous month"
 * structural rather than something to remember.
 */
export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const user = await requirePaOrManager();
  const searchParams = await props.searchParams;

  const raw =
    typeof searchParams.month === "string" ? searchParams.month : undefined;
  const request = parseMonthParam(raw);

  // A parameter that was supplied but did not parse is not the same as none at
  // all: it is a broken link, and the page says so rather than quietly showing
  // a different month.
  const requestWasMalformed = raw !== undefined && request === null;

  const result = await getDashboardData(request, { requestWasMalformed });

  // Everyone who can reach this page can also key figures in; the flag is here
  // so a future read-only role gets an explanation instead of a dead button.
  const canEnterData = hasRole(user, "manager", "pa");

  if (!result.ok) {
    // The message is already the safe, mapped one - `readErrorMessage` never
    // passes a raw Postgres error through to the screen.
    console.error("[dashboard] load failed:", result.error);

    return (
      <Alert tone="error" title="Unable to load dashboard data">
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

  const { months, selectedMonth, resolution, bundle, lastUpdatedAt } =
    result.data;

  const performance = buildMonthlyPerformanceViewModel(bundle);

  if (!performance) {
    // The selected month is missing from its own bundle - a fetch that should
    // not be able to happen, so it is reported rather than rendered around.
    return (
      <Alert tone="error" title="Unable to load dashboard data">
        <p>This month could not be assembled. Reload the page to try again.</p>
      </Alert>
    );
  }

  const dashboard = buildDashboardViewModel({
    selectedMonth,
    performance,
    lastUpdatedAt,
    notice: noticeFor(resolution, currentMonthLabel),
  });

  return (
    <div className="space-y-4">
      <DashboardHeader
        monthLabel={dashboard.month.label}
        quarterLabel={dashboard.month.quarterLabel}
        updatedLabel={dashboard.updatedLabel}
        controls={
          <>
            <MonthSwitcher months={months} selected={selectedMonth} />
            {/*
              The month is passed as the `?month=` value rather than as the row
              id, so the report is generated for the month the manager is
              looking at - including the one they were redirected to when the
              link named a month that does not exist.
            */}
            {canEnterData ? (
              <WhatsAppReport
                month={dashboard.month.param}
                monthLabel={dashboard.month.label}
              />
            ) : null}
          </>
        }
      />

      {dashboard.notice ? (
        <Alert
          tone={dashboard.notice.tone === "warning" ? "warning" : "info"}
          title={dashboard.notice.title}
        >
          <p>{dashboard.notice.body}</p>
        </Alert>
      ) : null}

      {!dashboard.hasAnyData ? (
        <DashboardEmptyState
          monthLabel={dashboard.month.label}
          monthId={dashboard.month.id}
          canEnterData={canEnterData}
        />
      ) : (
        <>
          <CompletenessBanner completeness={dashboard.completeness} />

          {/* Above the figures on purpose: the question a manager opens this
              page with is "is anything wrong", and the answer should not be
              three scrolls down on a phone. */}
          <ManagementAttention
            attention={dashboard.managementAttention}
            monthLabel={dashboard.month.label}
            currentWeekLabel={dashboard.currentWeekLabel}
          />

          <GroupKpis
            kpis={dashboard.kpis}
            target={dashboard.target}
            monthLabel={dashboard.month.label}
          />

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <WeeklyKeyIn
                weekly={dashboard.weekly}
                monthLabel={dashboard.month.label}
              />
            </div>

            <PeriodSummary
              monthOverMonth={dashboard.monthOverMonth}
              qtd={dashboard.qtd}
            />
          </div>

          <HmPerformance
            hms={dashboard.hms}
            monthLabel={dashboard.month.label}
          />
        </>
      )}
    </div>
  );
}

/**
 * Why the dashboard is not showing what was asked for.
 *
 * Silence is the failure mode being avoided here. A manager who opens the
 * dashboard on 1 October and reads September's figures under a September
 * heading has been told the truth; one who reads them believing October is on
 * screen has not, and the difference is this banner.
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
