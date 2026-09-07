"use client";

import { useState, useTransition, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import {
  commitHpImportAction,
  validateHpImportAction,
} from "@/lib/actions/hp-import";
import { monthLabel } from "@/lib/calendar";
import type { HpImportPreview } from "@/lib/import/hp-import";
// Not from `lib/actions/hp-import`: every export of a `"use server"` module has
// to be an async function, so the state shapes live in their own module.
import {
  initialHpImportCommitState,
  initialHpImportState,
  type HpImportCommitState,
} from "@/lib/import/import-state";
// And not from `lib/import/xlsx`, which reaches for `node:zlib` - importing it
// here just to read a number would pull a Node built-in into the browser.
import { MAX_XLSX_MB } from "@/lib/import/limits";
import { hpListingPath } from "@/lib/routes";
import type { Month } from "@/types/models";

type HpImportWorkspaceProps = {
  months: readonly Month[];
  /** The month the page resolved. The default, shown - never assumed silently. */
  selectedMonthId: string;
};

/**
 * The PA's Excel upload, end to end.
 *
 * ---------------------------------------------------------------------------
 * Two steps, and the gap between them is the feature
 * ---------------------------------------------------------------------------
 *   1. Choose a month, choose a file, VALIDATE. The file is read and every row
 *      is checked. Nothing is written.
 *   2. Look at the preview. Then, and only then, IMPORT.
 *
 * The PA is about to overwrite a month of figures from a spreadsheet they
 * maintain by hand. What they need before that happens is to see what it will
 * do - which HM each row mapped to, how many HPs are new, and every row that is
 * wrong, all at once rather than one at a time.
 *
 * While there is a single error, the import button is not offered at all. There
 * is no partial import to explain, because there is no partial import: the
 * whole commit is one database transaction.
 *
 * ---------------------------------------------------------------------------
 * The month is never implicit
 * ---------------------------------------------------------------------------
 * It defaults to the month the page was opened on and is stated in the heading,
 * beside the file name, and on the import button itself. Changing it CLEARS the
 * preview - a preview read under "September" and committed into August is the
 * one mistake this screen must not make possible.
 */
export function HpImportWorkspace({
  months,
  selectedMonthId,
}: HpImportWorkspaceProps) {
  const router = useRouter();

  const [monthId, setMonthId] = useState(selectedMonthId);
  const [fileName, setFileName] = useState<string | null>(null);

  const [validateState, validateAction] = useActionState(
    validateHpImportAction,
    initialHpImportState,
  );

  const [commitState, setCommitState] = useState<HpImportCommitState>(
    initialHpImportCommitState,
  );
  const [isCommitting, startCommit] = useTransition();

  // The preview belongs to the month it was validated under. Anything that
  // changes the month or the file makes it stale, and a stale preview is worse
  // than none.
  const [dismissedPreview, setDismissedPreview] = useState(false);

  // A fresh validation is always about the file just chosen, so it clears both
  // the dismissal and any previous commit outcome. Adjusted DURING RENDER
  // rather than in an effect: the new state is a function of the new props, and
  // an effect would render the stale combination once before correcting it.
  const [seenValidation, setSeenValidation] = useState(validateState);

  if (seenValidation !== validateState) {
    setSeenValidation(validateState);
    setDismissedPreview(false);
    setCommitState(initialHpImportCommitState);
  }

  const preview: HpImportPreview | null =
    dismissedPreview || validateState.monthId !== monthId
      ? null
      : validateState.preview;

  const month = months.find((entry) => entry.id === monthId) ?? null;
  const monthName = month ? monthLabel(month) : "the selected month";

  function commit() {
    if (!preview || !preview.canCommit || !validateState.fileName) {
      return;
    }

    startCommit(async () => {
      const result = await commitHpImportAction({
        month_id: monthId,
        file_name: validateState.fileName!,
        rows: preview.payload,
      });

      setCommitState(result);

      if (result.status === "success") {
        // The preview described a state that no longer exists.
        setDismissedPreview(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Upload the HP Excel"
          description="The spreadsheet is checked in full before anything is written. Nothing is imported until you confirm."
        />
        <CardBody>
          <form action={validateAction} className="space-y-4">
            <input type="hidden" name="month_id" value={monthId} />

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Import into"
                name="month_display"
                value={monthId}
                onChange={(event) => {
                  setMonthId(event.target.value);
                  setDismissedPreview(true);
                  setCommitState(initialHpImportCommitState);
                }}
                options={months.map((entry) => ({
                  value: entry.id,
                  label: `${monthLabel(entry)} · Q${entry.quarter}`,
                }))}
                hint="Only this month's HP figures are changed. Other months are untouched."
              />

              <div className="space-y-1.5">
                <label
                  htmlFor="hp-import-file"
                  className="block text-sm font-medium text-slate-700"
                >
                  Excel file
                </label>
                <input
                  id="hp-import-file"
                  name="file"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  required
                  onChange={(event) => {
                    setFileName(event.target.files?.[0]?.name ?? null);
                    setDismissedPreview(true);
                    setCommitState(initialHpImportCommitState);
                  }}
                  className="block w-full rounded-md text-sm text-slate-700 ring-1 ring-inset ring-slate-300 file:mr-3 file:min-h-11 file:rounded-l-md file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 focus:ring-2 focus:ring-inset focus:ring-sky-600"
                />
                <p className="text-xs text-slate-500">
                  .xlsx only, up to {MAX_XLSX_MB} MB. Columns: HM CODE, HP
                  NAME, HP CODE, W1–W4 KEY-IN, TOTAL KEY-IN, TOTAL NET.
                </p>
              </div>
            </div>

            {fileName ? (
              <p className="text-sm text-slate-600">
                Selected file:{" "}
                <span className="font-medium text-slate-900">{fileName}</span>
                {" → "}
                <span className="font-medium text-slate-900">{monthName}</span>
              </p>
            ) : null}

            <div className="flex justify-end">
              <ValidateButton />
            </div>
          </form>
        </CardBody>
      </Card>

      {validateState.status === "error" && validateState.message ? (
        <Alert tone="error" title="The file was not imported">
          <p>{validateState.message}</p>
        </Alert>
      ) : null}

      {preview ? (
        <HpImportPreviewPanel
          preview={preview}
          monthName={monthName}
          fileName={validateState.fileName}
          onCommit={commit}
          isCommitting={isCommitting}
          commitState={commitState}
        />
      ) : null}

      {commitState.status === "success" && commitState.result ? (
        <Card>
          <CardHeader title="Import successful" />
          <CardBody className="space-y-4">
            <Alert tone="success" title={`${monthName} updated`}>
              <p>
                Active HP on the dashboard is counted from these rows, so it has
                already changed.
              </p>
            </Alert>

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <ResultFigure
                label="Rows processed"
                value={commitState.result.rowsProcessed}
              />
              <ResultFigure label="New HP" value={commitState.result.newHp} />
              <ResultFigure
                label="Updated HP"
                value={commitState.result.updatedHp}
              />
              <ResultFigure
                label="Active HP"
                value={commitState.result.activeHp}
              />
              <ResultFigure
                label="Inactive HP"
                value={commitState.result.inactiveHp}
              />
            </dl>

            <p className="text-sm">
              <Link
                href={hpListingPath({ month: monthParamOf(month), activeOnly: true })}
                className="font-medium text-sky-800 underline underline-offset-2"
              >
                View the {monthName} HP list
              </Link>
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/** `?month=` for a month row, without pulling the server-side helper in. */
function monthParamOf(month: Month | null): string | null {
  return month ? `${month.year}-${String(month.month).padStart(2, "0")}` : null;
}

function ValidateButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Checking the file…" : "Validate file"}
    </Button>
  );
}

function ResultFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums leading-none text-slate-900">
        {value}
      </dd>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The preview
// -----------------------------------------------------------------------------

type PreviewPanelProps = {
  preview: HpImportPreview;
  monthName: string;
  fileName: string | null;
  onCommit: () => void;
  isCommitting: boolean;
  commitState: HpImportCommitState;
};

/**
 * What the import will do, before it does it.
 *
 * The summary first, because it is the thing a PA checks at a glance - 148
 * rows, 6 HMs, 11 new HPs. Then the errors, in row order, each one naming the
 * row and the offending value. Then the rows themselves, with the HM Code the
 * row mapped to, so a mis-typed code is visible as a mapping rather than as a
 * number that turns out wrong next week.
 *
 * Both totals are shown side by side: the one this application calculated from
 * W1-W4, and the one the spreadsheet carries. They agree on every row of a
 * clean file; the column exists so that when they do not, the PA can see which
 * is which.
 */
function HpImportPreviewPanel({
  preview,
  monthName,
  fileName,
  onCommit,
  isCommitting,
  commitState,
}: PreviewPanelProps) {
  const { summary } = preview;

  return (
    <Card>
      <CardHeader
        title={`HP import — ${monthName}`}
        description={fileName ?? undefined}
      />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <ResultFigure label="Rows detected" value={summary.rowsDetected} />
          <ResultFigure label="HM matched" value={summary.hmsMatched} />
          <ResultFigure label="New HP" value={summary.newHp} />
          <ResultFigure label="Existing HP" value={summary.updatedHp} />
          <ResultFigure label="Active HP" value={summary.activeHp} />
          <ResultFigure label="Inactive HP" value={summary.inactiveHp} />
        </dl>

        {preview.errors.length > 0 ? (
          <Alert
            tone="error"
            title={`${preview.errors.length} problem${preview.errors.length === 1 ? "" : "s"} — nothing can be imported`}
          >
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {preview.errors.slice(0, 50).map((issue, index) => (
                <li key={`${issue.code}-${issue.rowNumber}-${index}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
            {preview.errors.length > 50 ? (
              <p className="mt-2">
                …and {preview.errors.length - 50} more. Fix these first — the
                rest may be the same mistake.
              </p>
            ) : null}
          </Alert>
        ) : null}

        {preview.warnings.length > 0 ? (
          <Alert tone="warning" title="Worth knowing">
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {preview.warnings.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {commitState.status === "error" && commitState.message ? (
          <Alert tone="error" title="The import was refused">
            <p>{commitState.message}</p>
            <p className="mt-1">Nothing was written. {monthName} is unchanged.</p>
          </Alert>
        ) : null}

        {preview.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Every row of the uploaded file, with the HM it mapped to
              </caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Row
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    HM Code
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    HM Name
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    HP Name
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    HP Code
                  </th>
                  {["W1", "W2", "W3", "W4"].map((week) => (
                    <th
                      key={week}
                      scope="col"
                      className="py-2 pr-2 text-right font-medium"
                    >
                      {week}
                    </th>
                  ))}
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Total KI
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Excel KI
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Total Net
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.slice(0, 500).map((row) => {
                  const mismatch =
                    row.excelTotalKeyIn !== null &&
                    row.excelTotalKeyIn !== row.totalKeyIn;

                  return (
                    <tr
                      key={`${row.rowNumber}-${row.hpCode}`}
                      className={row.hmId === null ? "bg-rose-50/60" : undefined}
                    >
                      <td className="py-2 pr-3 tabular-nums text-slate-400">
                        {row.rowNumber}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-slate-700">
                        {row.hmCode || "—"}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {row.hmName ?? (
                          <span className="font-medium text-rose-700">
                            No such HM Code
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-medium text-slate-900">
                        {row.hpName || "—"}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-slate-600">
                        {row.hpCode || "—"}
                      </td>
                      {[row.w1, row.w2, row.w3, row.w4].map((value, index) => (
                        <td
                          key={index}
                          className="py-2 pr-2 text-right tabular-nums text-slate-600"
                        >
                          {value}
                        </td>
                      ))}
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums text-slate-900">
                        {row.totalKeyIn}
                      </td>
                      <td
                        className={
                          mismatch
                            ? "py-2 pr-3 text-right font-semibold tabular-nums text-rose-700"
                            : "py-2 pr-3 text-right tabular-nums text-slate-400"
                        }
                      >
                        {row.excelTotalKeyIn ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                        {row.totalNet}
                      </td>
                      <td className="py-2">
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={row.isNew ? "accent" : "neutral"}>
                            {row.isNew ? "NEW HP" : "UPDATE"}
                          </Badge>
                          <Badge tone={row.isActive ? "positive" : "muted"}>
                            {row.isActive ? "ACTIVE" : "INACTIVE"}
                          </Badge>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {preview.rows.length > 500 ? (
              <p className="mt-2 text-xs text-slate-500">
                Showing the first 500 of {preview.rows.length} rows. All{" "}
                {preview.rows.length} will be imported.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4">
          {preview.canCommit ? (
            <p className="mr-auto text-sm text-slate-500">
              This will replace {monthName}&apos;s HP figures for the{" "}
              {preview.summary.rowsDetected} rows above. No other month is
              touched.
            </p>
          ) : null}

          <Button
            onClick={onCommit}
            disabled={!preview.canCommit || isCommitting}
            title={
              preview.canCommit
                ? undefined
                : "Fix the problems above, then upload the file again"
            }
          >
            {isCommitting
              ? "Importing…"
              : `Import ${preview.summary.rowsDetected} rows into ${monthName}`}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
