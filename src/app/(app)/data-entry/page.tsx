import type { Metadata } from "next";

import { DataEntryWorkspace } from "@/components/data-entry/data-entry-workspace";
import { MonthSelector } from "@/components/data-entry/month-selector";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { isManager, requirePaOrManager } from "@/lib/auth/session";
import { resolveSelectedMonth } from "@/lib/calendar";
import { listMonths } from "@/lib/data/months";
import { getMonthWorkbook } from "@/lib/data/performance";

export const metadata: Metadata = { title: "Data Entry" };

/**
 * The PA's workspace.
 *
 * The month lives in the URL rather than in component state, which is what
 * makes "no stale values from the previous month" structural rather than
 * something to remember: changing month is a navigation, the whole page is
 * re-fetched for the new `month_id`, and the grid is remounted with that
 * month's data.
 *
 * The page itself only loads and guards. Every piece of month-scoped state -
 * the draft grid, the calendar being edited, whether anything is unsaved -
 * belongs to one client component, so the month selector can refuse to navigate
 * away from unsaved work instead of finding out too late.
 */
export default async function DataEntryPage(props: PageProps<"/data-entry">) {
  const user = await requirePaOrManager();
  const searchParams = await props.searchParams;
  const requested =
    typeof searchParams.month === "string" ? searchParams.month : undefined;

  const monthsResult = await listMonths();

  if (!monthsResult.ok) {
    return (
      <>
        <PageHeader title="Data Entry" />
        <Alert tone="error" title="Could not load the reporting months">
          <p>{monthsResult.error}</p>
        </Alert>
      </>
    );
  }

  const months = monthsResult.data;
  const selected = resolveSelectedMonth(months, requested);

  if (!selected) {
    return (
      <>
        <PageHeader
          title="Data Entry"
          description="Monthly KPIs and weekly Key-In units, keyed in by the PA."
        />

        <Card>
          <CardHeader title="No reporting months yet" />
          <CardBody className="space-y-4">
            <Alert tone="info">
              <p>
                Open a reporting month to begin. The quarter and label are
                derived from the year and month.
              </p>
            </Alert>
            <MonthSelector
              months={months}
              selected={null}
              hasUnsavedChanges={false}
            />
          </CardBody>
        </Card>
      </>
    );
  }

  const workbook = await getMonthWorkbook(selected.id);

  return (
    <>
      <PageHeader
        title="Data Entry"
        description="Monthly KPIs and weekly Key-In units. Sales are counted in units, never in ringgit."
      />

      {!workbook.ok ? (
        <Alert tone="error" title="Could not load this month">
          <p>{workbook.error}</p>
        </Alert>
      ) : (
        <DataEntryWorkspace
          // Remounted per month, so no edit can survive a month switch.
          key={selected.id}
          months={months}
          month={selected}
          hms={workbook.data.hms}
          weeks={workbook.data.weeks}
          monthly={workbook.data.monthly}
          weekly={workbook.data.weekly}
          groupMetrics={workbook.data.groupMetrics}
          inactiveWithHistory={workbook.data.inactiveWithHistory}
          canClearSavedWeeks={isManager(user)}
          canDeleteWeekWithData={isManager(user)}
        />
      )}
    </>
  );
}
