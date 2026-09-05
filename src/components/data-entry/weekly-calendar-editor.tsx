"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  deleteSalesWeekAction,
  saveSalesCalendarAction,
} from "@/lib/actions/sales-weeks";
import { nextAvailableWeekNumber, suggestWeekRange } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import {
  defaultWeekLabel,
  findDuplicateWeekNumbers,
  findOverlappingWeeks,
} from "@/lib/validation/sales-week";
import type { Month, SalesWeek } from "@/types/models";

type WeeklyCalendarEditorProps = {
  month: Month;
  weeks: readonly SalesWeek[];
  canDeleteWeekWithData: boolean;
};

type WeekRow = {
  /** Present once the row exists in the database. */
  id?: string;
  week_number: number;
  week_label: string;
  start_date: string;
  end_date: string;
};

/**
 * Coway's official weekly calendar for one month.
 *
 * The single most important thing here is what it does NOT do: it never derives
 * a date from a week number. Coway publishes the periods, they routinely start
 * in the previous calendar month and end in the next, they are not seven days
 * long as a rule, and a month may have four, five or six of them. Every date on
 * this table is typed in by the PA.
 *
 * The whole calendar saves in one request. Overlap is a property of the set, and
 * the database enforces it with a deferred constraint trigger that runs at
 * COMMIT - so shifting four weeks along by a day succeeds as one transaction,
 * where saving row by row would trip on the first write.
 */
export function WeeklyCalendarEditor({
  month,
  weeks,
  canDeleteWeekWithData,
}: WeeklyCalendarEditorProps) {
  const router = useRouter();
  const [rows, setRows] = useState<WeekRow[]>(() => weeks.map(toRow));
  const [notice, setNotice] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const issues = useMemo(() => validate(rows), [rows]);
  const isDirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(weeks.map(toRow)),
    [rows, weeks],
  );

  function update(index: number, patch: Partial<WeekRow>) {
    setNotice(null);
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addWeek() {
    const weekNumber = nextAvailableWeekNumber(rows);

    if (weekNumber === null) {
      setNotice({
        tone: "warning",
        message: "A month can have at most six sales weeks.",
      });
      return;
    }

    const suggested = suggestWeekRange(rows, month);

    setNotice(null);
    setRows((current) =>
      [
        ...current,
        {
          week_number: weekNumber,
          week_label: defaultWeekLabel(weekNumber),
          ...suggested,
        },
      ].sort((a, b) => a.week_number - b.week_number),
    );
  }

  function removeRow(index: number) {
    const row = rows[index];

    if (!row) {
      return;
    }

    // Never saved: drop it locally, nothing to ask about.
    if (!row.id) {
      setRows((current) => current.filter((_, i) => i !== index));
      return;
    }

    setNotice(null);
    setPendingDelete(row.id);

    startSaving(async () => {
      let result = await deleteSalesWeekAction(row.id!);

      // The week holds Key-In. The action refuses the first time and says how
      // much data goes with it; only a manager is offered the second chance.
      if (
        result.status === "error" &&
        typeof result.keyInRows === "number" &&
        result.keyInRows > 0 &&
        canDeleteWeekWithData
      ) {
        if (window.confirm(`${result.message} This cannot be undone.`)) {
          result = await deleteSalesWeekAction(row.id!, { confirmed: true });
        } else {
          setPendingDelete(null);
          return;
        }
      }

      setPendingDelete(null);

      if (result.status === "error") {
        setNotice({ tone: "error", message: result.message ?? "Failed." });
        return;
      }

      setRows((current) => current.filter((_, i) => i !== index));
      setNotice({ tone: "success", message: result.message ?? "Week removed." });
      router.refresh();
    });
  }

  function save() {
    if (issues.length > 0) {
      return;
    }

    setNotice(null);

    startSaving(async () => {
      const result = await saveSalesCalendarAction({
        month_id: month.id,
        weeks: rows.map((row) => ({
          week_number: row.week_number,
          week_label: row.week_label,
          start_date: row.start_date,
          end_date: row.end_date,
        })),
      });

      setNotice({
        tone: result.status === "error" ? "error" : "success",
        message: result.message ?? "Saved.",
      });

      if (result.status === "success") {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <Alert tone={notice.tone === "success" ? "success" : notice.tone}>
          {notice.message}
        </Alert>
      ) : null}

      {issues.length > 0 ? (
        <Alert tone="error" title="Fix these before saving">
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <Alert tone="warning" title="No sales weeks configured">
          <p>
            Weekly Key-In cannot be entered until this month has its Coway
            periods. Add them exactly as published — they are not calendar weeks
            and often start in the previous month.
          </p>
        </Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Week
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Label
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Start date
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  End date
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Days
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, index) => {
                const invalidRange = row.start_date > row.end_date;

                return (
                  <tr key={row.id ?? `new-${row.week_number}`}>
                    <td className="py-2 pr-4 font-medium tabular-nums text-slate-900">
                      W{row.week_number}
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="text"
                        value={row.week_label}
                        aria-label={`Week ${row.week_number} label`}
                        onChange={(event) =>
                          update(index, { week_label: event.target.value })
                        }
                        className="w-24 rounded-md border-0 px-2 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-sky-600"
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="date"
                        value={row.start_date}
                        aria-label={`Week ${row.week_number} start date`}
                        onChange={(event) =>
                          update(index, { start_date: event.target.value })
                        }
                        className={cn(
                          "rounded-md border-0 px-2 py-1.5 text-sm shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-inset focus:ring-sky-600",
                          invalidRange ? "ring-red-400" : "ring-slate-300",
                        )}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="date"
                        value={row.end_date}
                        aria-label={`Week ${row.week_number} end date`}
                        onChange={(event) =>
                          update(index, { end_date: event.target.value })
                        }
                        className={cn(
                          "rounded-md border-0 px-2 py-1.5 text-sm shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-inset focus:ring-sky-600",
                          invalidRange ? "ring-red-400" : "ring-slate-300",
                        )}
                      />
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-slate-500">
                      {invalidRange ? "—" : dayCount(row.start_date, row.end_date)}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        className="text-red-700 hover:bg-red-50"
                        onClick={() => removeRow(index)}
                        disabled={isSaving && pendingDelete === row.id}
                      >
                        {pendingDelete === row.id ? "Removing…" : "Delete"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={addWeek} disabled={isSaving}>
          + Add week
        </Button>

        <div className="flex items-center gap-2">
          {isDirty ? (
            <span className="text-sm text-slate-500">Unsaved calendar changes</span>
          ) : null}
          <Button
            onClick={save}
            disabled={isSaving || issues.length > 0 || !isDirty}
          >
            {isSaving ? "Saving…" : "Save calendar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function toRow(week: SalesWeek): WeekRow {
  return {
    id: week.id,
    week_number: week.week_number,
    week_label: week.week_label,
    start_date: week.start_date,
    end_date: week.end_date,
  };
}

/**
 * Human-readable problems with the calendar as a whole.
 *
 * Mirrors `salesWeekCalendarSchema`, which the Server Action re-runs, which the
 * deferred database trigger backs up. Three layers saying the same thing on
 * purpose - this one exists only to say it before the PA presses Save.
 */
function validate(rows: readonly WeekRow[]): string[] {
  const issues: string[] = [];

  for (const row of rows) {
    if (!row.start_date || !row.end_date) {
      issues.push(`Week ${row.week_number} needs both a start and an end date.`);
      continue;
    }

    if (row.start_date > row.end_date) {
      issues.push(
        `Week ${row.week_number} end date cannot be before the start date.`,
      );
    }

    if (row.week_number < 1 || row.week_number > 6) {
      issues.push("Week number must be between 1 and 6.");
    }
  }

  for (const weekNumber of findDuplicateWeekNumbers(rows)) {
    issues.push(`Week ${weekNumber} is listed more than once.`);
  }

  const dated = rows.filter((row) => row.start_date && row.end_date);

  for (const [first, second] of findOverlappingWeeks(dated)) {
    issues.push(`Week periods cannot overlap: W${first} and W${second}.`);
  }

  return [...new Set(issues)];
}

/** Inclusive of both ends, so a Mon-Sun period reads as 7. */
function dayCount(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return 0;
  }

  return Math.round((to - from) / 86_400_000) + 1;
}
