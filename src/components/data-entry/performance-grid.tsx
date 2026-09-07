"use client";

import { memo, useCallback, useRef, type KeyboardEvent } from "react";

import { DerivedCell, GridCell } from "@/components/data-entry/grid-cell";
import { HmAvatar } from "@/components/hm/hm-avatar";
import { Badge } from "@/components/ui/badge";
import { STATUS_DOT_CLASSES } from "@/components/ui/status-styles";
import { formatWeekRange } from "@/lib/calendar";
import {
  extradePercentage,
  extradeRemainder,
  formatPercentage,
  nonExtradePercentage,
  recruitmentStatus,
  sumKeyIn,
  targetAchievement,
  weeklyKeyInStatus,
} from "@/lib/calculations/performance";
import {
  MONTHLY_FIELDS,
  rowValues,
  weeklyEntries,
  type MonthlyField,
  type RowDraft,
  type RowErrors,
} from "@/lib/data-entry/grid-model";
import { cn } from "@/lib/utils";
import { weeklyCellField } from "@/lib/validation/data-entry";
import type { HM, SalesWeek } from "@/types/models";

type PerformanceGridProps = {
  hms: readonly HM[];
  weeks: readonly SalesWeek[];
  rows: Record<string, RowDraft>;
  errors: Record<string, RowErrors>;
  inactiveWithHistory: ReadonlySet<string>;
  onCellChange: (hmId: string, field: string, text: string) => void;
};

/**
 * The spreadsheet.
 *
 * A single grid rather than the three stacked tables the brief sketches: the
 * PA reads across one HM at a time, and splitting the columns into separate
 * tables means finding the same person three times and losing the connection
 * between the Key-In total and the Extrade split shown as a share of it. The
 * column groups keep the sections legible while the row stays one row.
 *
 * Everything derived - Key-In total, achievement, the two mix percentages, the
 * split difference - is rendered read-only in line, so the arithmetic the PA
 * would otherwise do on paper is visible while they type. Both mix percentages
 * are shares of TOTAL KEY-IN; Extrade and Non-Extrade themselves are independent
 * figures the PA keys in freely and nothing here checks them against Net.
 */
export function PerformanceGrid({
  hms,
  weeks,
  rows,
  errors,
  inactiveWithHistory,
  onCellChange,
}: PerformanceGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Weekly cells first, then the seven monthly fields, matching DOM order - so
  // Tab already does the right thing and only the other keys need handling.
  const columnCount = weeks.length + MONTHLY_FIELDS.length;

  const focusCell = useCallback((row: number, column: number) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const target = container.querySelector<HTMLInputElement>(
      `[data-cell="${row}:${column}"]`,
    );

    if (target) {
      target.focus();
      target.select();
    }
  }, []);

  /**
   * Enter and the arrow keys.
   *
   * Left/right only move between cells when the caret is already at the edge of
   * the text, so arrowing through a number the PA is correcting still works the
   * way it does everywhere else. Up/down always move, because vertical caret
   * movement means nothing in a single-line input.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const input = event.target as HTMLInputElement;
      const position = input.dataset?.cell;

      if (!position) {
        return;
      }

      const [rowText, columnText] = position.split(":");
      const row = Number(rowText);
      const column = Number(columnText);

      if (!Number.isFinite(row) || !Number.isFinite(column)) {
        return;
      }

      const lastRow = hms.length - 1;
      const lastColumn = columnCount - 1;

      switch (event.key) {
        case "Enter":
          event.preventDefault();
          focusCell(
            event.shiftKey ? Math.max(0, row - 1) : Math.min(lastRow, row + 1),
            column,
          );
          break;

        case "ArrowDown":
          event.preventDefault();
          focusCell(Math.min(lastRow, row + 1), column);
          break;

        case "ArrowUp":
          event.preventDefault();
          focusCell(Math.max(0, row - 1), column);
          break;

        case "ArrowLeft":
          if (input.selectionStart === 0 && input.selectionEnd === 0) {
            event.preventDefault();
            focusCell(row, Math.max(0, column - 1));
          }
          break;

        case "ArrowRight":
          if (
            input.selectionStart === input.value.length &&
            input.selectionEnd === input.value.length
          ) {
            event.preventDefault();
            focusCell(row, Math.min(lastColumn, column + 1));
          }
          break;

        default:
          break;
      }
    },
    [columnCount, focusCell, hms.length],
  );

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
      className="overflow-x-auto rounded-md border border-slate-200"
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Monthly performance and weekly Key-In by Health Manager. Use the arrow
          keys or Enter to move between cells.
        </caption>

        <thead>
          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <th
              scope="col"
              rowSpan={2}
              className="sticky left-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium"
            >
              HM
            </th>
            <th
              scope="colgroup"
              colSpan={weeks.length + 1}
              className="border-b border-l border-slate-200 px-2 py-1.5 text-center font-medium"
            >
              Weekly Key-In
            </th>
            <th
              scope="colgroup"
              colSpan={6}
              className="border-b border-l border-slate-200 px-2 py-1.5 text-center font-medium"
            >
              Monthly performance
            </th>
            <th
              scope="colgroup"
              colSpan={5}
              className="border-b border-l border-slate-200 px-2 py-1.5 text-center font-medium"
            >
              Sales mix
            </th>
          </tr>

          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            {weeks.map((week, index) => (
              <th
                key={week.id}
                scope="col"
                className={cn(
                  "border-b border-slate-200 px-2 py-2 text-right font-medium",
                  index === 0 && "border-l",
                )}
                title={formatWeekRange(week)}
              >
                <span className="block">{week.week_label}</span>
                <span className="block text-[10px] font-normal normal-case text-slate-400">
                  {formatWeekRange(week)}
                </span>
              </th>
            ))}
            <HeaderCell label="Total" hint="Sum of the weeks" />
            <HeaderCell label="Net" borderLeft />
            <HeaderCell label="Target" />
            <HeaderCell label="Ach %" hint="Net / Target" />
            <HeaderCell label="Recruit" />
            <HeaderCell label="Active HP" />
            <HeaderCell label="SHI %" hint="From eTrust" />
            <HeaderCell label="Extrade" borderLeft />
            <HeaderCell label="%" hint="Extrade / Total Key-In" />
            <HeaderCell label="Non-Ex" />
            <HeaderCell label="%" hint="Non-Extrade / Total Key-In" />
            <HeaderCell label="Balance" hint="Total − Extrade − Non-Extrade" />
          </tr>
        </thead>

        <tbody>
          {hms.map((hm, index) => (
            <PerformanceGridRow
              key={hm.id}
              hm={hm}
              rowIndex={index}
              weeks={weeks}
              draft={rows[hm.id]}
              errors={errors[hm.id]}
              isInactive={inactiveWithHistory.has(hm.id)}
              onCellChange={onCellChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeaderCell({
  label,
  hint,
  borderLeft,
}: {
  label: string;
  hint?: string;
  borderLeft?: boolean;
}) {
  return (
    <th
      scope="col"
      title={hint}
      className={cn(
        "border-b border-slate-200 px-2 py-2 text-right font-medium",
        borderLeft && "border-l",
      )}
    >
      {label}
    </th>
  );
}

// -----------------------------------------------------------------------------
// One HM
// -----------------------------------------------------------------------------

type RowProps = {
  hm: HM;
  rowIndex: number;
  weeks: readonly SalesWeek[];
  draft: RowDraft | undefined;
  errors: RowErrors | undefined;
  isInactive: boolean;
  onCellChange: (hmId: string, field: string, text: string) => void;
};

/**
 * Memoised on purpose.
 *
 * Fifty HMs across thirteen columns is over six hundred inputs; re-rendering
 * all of them on every keystroke is what makes this kind of grid feel heavy.
 * Only the edited row gets a new draft object, so only that row re-renders.
 */
const PerformanceGridRow = memo(function PerformanceGridRow({
  hm,
  rowIndex,
  weeks,
  draft,
  errors,
  isInactive,
  onCellChange,
}: RowProps) {
  if (!draft) {
    return null;
  }

  const values = rowValues(draft, weeks);
  const weekly = weeklyEntries(draft, weeks);
  const keyInTotal = sumKeyIn(weekly);
  // Against the Key-In total, not Net: the two split cells are independent
  // figures, and this column only shows how much of Key-In they cover.
  const remainder = extradeRemainder(
    keyInTotal,
    values.extrade_units,
    values.non_extrade_units,
  );
  const rowErrors = errors ?? {};

  const monthlyColumn = (field: MonthlyField) =>
    weeks.length + MONTHLY_FIELDS.indexOf(field);

  return (
    <tr className="odd:bg-white even:bg-slate-50/40">
      <th
        scope="row"
        className="sticky left-0 z-10 border-b border-slate-100 bg-inherit px-3 py-1.5 text-left font-normal"
      >
        <div className="flex items-center gap-2">
          <HmAvatar name={hm.name} photoUrl={hm.photo_url} size="sm" />
          <span className="whitespace-nowrap font-medium text-slate-900">
            {hm.name}
          </span>
          {isInactive ? (
            <Badge tone="muted" className="whitespace-nowrap">
              Inactive
            </Badge>
          ) : null}
        </div>
      </th>

      {weeks.map((week, index) => {
        const field = weeklyCellField(week.id);

        return (
          <GridCell
            key={week.id}
            value={draft.weekly[week.id] ?? ""}
            onChange={(text) => onCellChange(hm.id, field, text)}
            row={rowIndex}
            column={index}
            field={field}
            label={`${hm.name} ${week.week_label} Key-In`}
            status={weeklyKeyInStatus(weekly[index] ?? null)}
            error={rowErrors[field]}
            className={index === 0 ? "border-l border-slate-200" : undefined}
          />
        );
      })}

      <DerivedCell emphasis title="Sum of the weekly Key-In figures">
        {keyInTotal}
      </DerivedCell>

      <MonthlyCell
        hm={hm}
        draft={draft}
        errors={rowErrors}
        field="net_units"
        label="Net units"
        rowIndex={rowIndex}
        column={monthlyColumn("net_units")}
        onCellChange={onCellChange}
        className="border-l border-slate-200"
      />
      <MonthlyCell
        hm={hm}
        draft={draft}
        errors={rowErrors}
        field="target_net_units"
        label="Net target"
        rowIndex={rowIndex}
        column={monthlyColumn("target_net_units")}
        onCellChange={onCellChange}
      />
      <DerivedCell title="Net against this HM's target for the month">
        {formatPercentage(
          targetAchievement(values.net_units, values.target_net_units),
        )}
      </DerivedCell>

      <MonthlyCell
        hm={hm}
        draft={draft}
        errors={rowErrors}
        field="recruitment"
        label="Recruitment"
        rowIndex={rowIndex}
        column={monthlyColumn("recruitment")}
        status={recruitmentStatus(values.recruitment)}
        onCellChange={onCellChange}
      />
      <MonthlyCell
        hm={hm}
        draft={draft}
        errors={rowErrors}
        field="shi_percentage"
        label="SHI percentage"
        rowIndex={rowIndex}
        column={monthlyColumn("shi_percentage")}
        decimal
        onCellChange={onCellChange}
      />

      <MonthlyCell
        hm={hm}
        draft={draft}
        errors={rowErrors}
        field="extrade_units"
        label="Extrade units"
        rowIndex={rowIndex}
        column={monthlyColumn("extrade_units")}
        onCellChange={onCellChange}
        className="border-l border-slate-200"
      />
      <DerivedCell>
        {formatPercentage(extradePercentage(values.extrade_units, keyInTotal))}
      </DerivedCell>
      <MonthlyCell
        hm={hm}
        draft={draft}
        errors={rowErrors}
        field="non_extrade_units"
        label="Non-Extrade units"
        rowIndex={rowIndex}
        column={monthlyColumn("non_extrade_units")}
        onCellChange={onCellChange}
      />
      <DerivedCell>
        {formatPercentage(
          nonExtradePercentage(values.non_extrade_units, keyInTotal),
        )}
      </DerivedCell>

      <BalanceCell remainder={remainder} />
    </tr>
  );
});

type MonthlyCellProps = {
  hm: HM;
  draft: RowDraft;
  errors: RowErrors;
  field: MonthlyField;
  label: string;
  rowIndex: number;
  column: number;
  decimal?: boolean;
  status?: Parameters<typeof GridCell>[0]["status"];
  className?: string;
  onCellChange: (hmId: string, field: string, text: string) => void;
};

function MonthlyCell({
  hm,
  draft,
  errors,
  field,
  label,
  rowIndex,
  column,
  decimal,
  status,
  className,
  onCellChange,
}: MonthlyCellProps) {
  return (
    <GridCell
      value={draft.monthly[field] ?? ""}
      onChange={(text) => onCellChange(hm.id, field, text)}
      row={rowIndex}
      column={column}
      field={field}
      label={`${hm.name} ${label}`}
      status={status}
      error={errors[field]}
      decimal={decimal}
      className={className}
    />
  );
}

/**
 * How far the Extrade split is from Net.
 *
 * The database will refuse the row unless this is zero, so showing the gap while
 * it is being typed turns a rejected save into an obvious "12 units still to
 * allocate".
 */
/**
 * How much of the Key-In total the split covers - a running difference, not a
 * rule. Extrade and Non-Extrade are independent figures, so any value here is a
 * perfectly saveable row; the column is shown in the same quiet ink as the other
 * derived cells rather than flagged, so nothing reads as an error.
 */
function BalanceCell({ remainder }: { remainder: number | null }) {
  if (remainder === null) {
    return (
      <DerivedCell title="Enter Extrade and Non-Extrade">—</DerivedCell>
    );
  }

  if (remainder === 0) {
    return (
      <DerivedCell title="Extrade + Non-Extrade comes to the Key-In total">
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", STATUS_DOT_CLASSES.green)}
          />
          OK
        </span>
      </DerivedCell>
    );
  }

  return (
    <DerivedCell
      title={
        remainder > 0
          ? `${remainder} Key-In unit${remainder === 1 ? "" : "s"} are not in the split`
          : `The split is ${Math.abs(remainder)} above the Key-In total`
      }
    >
      {remainder > 0 ? `+${remainder}` : remainder}
    </DerivedCell>
  );
}
