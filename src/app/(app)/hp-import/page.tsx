import type { Metadata } from "next";
import Link from "next/link";

import { HpImportWorkspace } from "@/components/hp/hp-import-workspace";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePaOrManager } from "@/lib/auth/session";
import {
  formatUpdatedAt,
  monthParam,
  parseMonthParam,
  resolveDashboardMonth,
} from "@/lib/calendar";
import { listHpImportRuns } from "@/lib/data/hp";
import { listMonths } from "@/lib/data/months";
import { hpListingPath, ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Import HP Excel" };

/**
 * The PA's Excel upload.
 *
 * The page guards, resolves the month and loads the recent import history. All
 * of the work - reading the file, validating it, showing the preview and
 * committing - belongs to one client component, because the preview and the
 * month it was built for are a single piece of state that must not be able to
 * drift apart.
 *
 * The whole flow is two Server Actions, and neither of them is the boundary:
 * `import_hp_month` re-runs every check as the caller under RLS, so a direct
 * POST meets the same rules with the same messages.
 */
export default async function HpImportPage(props: PageProps<"/hp-import">) {
  await requirePaOrManager();

  const searchParams = await props.searchParams;
  const raw =
    typeof searchParams.month === "string" ? searchParams.month : undefined;

  const monthsResult = await listMonths();

  if (!monthsResult.ok) {
    return (
      <>
        <PageHeader title="Import HP Excel" />
        <Alert tone="error" title="Could not load the reporting months">
          <p>{monthsResult.error}</p>
        </Alert>
      </>
    );
  }

  const months = monthsResult.data;
  const request = parseMonthParam(raw);
  const resolution = resolveDashboardMonth(months, request, {
    requestWasMalformed: raw !== undefined && request === null,
  });

  const selectedMonth = resolution.month;

  if (!selectedMonth) {
    return (
      <>
        <PageHeader
          title="Import HP Excel"
          description="Upload the PA's monthly HP spreadsheet."
        />
        <Card>
          <CardHeader title="No reporting months yet" />
          <CardBody>
            <Alert tone="info">
              <p>
                Open a reporting month in{" "}
                <Link
                  href={ROUTES.dataEntry}
                  className="font-medium underline underline-offset-2"
                >
                  Data Entry
                </Link>{" "}
                first. An import always targets one month, so there has to be
                one to import into.
              </p>
            </Alert>
          </CardBody>
        </Card>
      </>
    );
  }

  const runsResult = await listHpImportRuns(selectedMonth.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Import HP Excel"
        description="Update the spreadsheet as usual, then upload it here. The file is checked in full and shown to you before anything is written — an import either lands completely or not at all."
        action={
          <Link
            href={hpListingPath({
              month: monthParam(selectedMonth),
              activeOnly: true,
            })}
            className="inline-flex min-h-11 items-center rounded-md px-3.5 text-sm font-medium text-sky-700 ring-1 ring-inset ring-slate-300 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            View HP list
          </Link>
        }
      />

      <HpImportWorkspace months={months} selectedMonthId={selectedMonth.id} />

      {runsResult.ok && runsResult.data.length > 0 ? (
        <Card>
          <CardHeader
            title="Recent imports for this month"
            description="For your own check - which file went in, and when."
          />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      File
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Imported
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Rows
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      New HP
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Active HP
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runsResult.data.map((run) => (
                    <tr key={run.id}>
                      <td className="py-2.5 pr-4 break-all font-medium text-slate-900">
                        {run.file_name}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-500">
                        {formatUpdatedAt(run.created_at) ?? "—"} (MYT)
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">
                        {run.rows_processed}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">
                        {run.new_hp_count}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-600">
                        {run.active_hp_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
