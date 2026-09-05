"use client";

import { memo } from "react";

import { STATUS_CELL_CLASSES } from "@/components/ui/status-styles";
import type { PerformanceStatus } from "@/lib/calculations/performance";
import { cn } from "@/lib/utils";

type GridCellProps = {
  value: string;
  onChange: (text: string) => void;
  /** Row and column position, used by the grid's keyboard navigation. */
  row: number;
  column: number;
  /** Cell key the row's error map is looked up by. */
  field: string;
  label: string;
  status?: PerformanceStatus;
  error?: string;
  decimal?: boolean;
  className?: string;
};

/**
 * One editable cell.
 *
 * `type="text"` with `inputMode`, not `type="number"`. A number input in a grid
 * is a liability: the scroll wheel silently changes whichever cell the pointer
 * happens to be over, the spinner arrows eat horizontal space in every column,
 * and browsers hand back an empty string for text they cannot parse - so a
 * pasted `12a` disappears instead of being reported. Holding the raw text and
 * parsing it ourselves keeps every one of those cases visible.
 *
 * Uncontrolled-feeling but fully controlled: the value always comes from the
 * draft, so undo, month switching and a failed save all stay consistent.
 */
export const GridCell = memo(function GridCell({
  value,
  onChange,
  row,
  column,
  field,
  label,
  status = "neutral",
  error,
  decimal = false,
  className,
}: GridCellProps) {
  return (
    <td className="border-b border-slate-100 p-0">
      <input
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        autoComplete="off"
        value={value}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        data-cell={`${row}:${column}`}
        data-field={field}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.target.select()}
        className={cn(
          "w-full min-w-14 border-0 px-2 py-1.5 text-right text-sm tabular-nums",
          "focus:relative focus:z-10 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-sky-600",
          // Exactly one background/text pair, never two. `cn` is a plain join,
          // so two competing `bg-*` utilities would be settled by the order
          // Tailwind happens to emit them in rather than by intent - which is
          // how a `bg-transparent` base silently cancelled every status tint.
          error
            ? "bg-red-50 text-red-900 outline outline-1 -outline-offset-1 outline-red-400"
            : STATUS_CELL_CLASSES[status],
          className,
        )}
      />
    </td>
  );
});

type ReadOnlyCellProps = {
  children: React.ReactNode;
  title?: string;
  className?: string;
  emphasis?: boolean;
};

/** A derived figure. Never editable — Key-In totals and percentages live here. */
export function DerivedCell({
  children,
  title,
  className,
  emphasis,
}: ReadOnlyCellProps) {
  return (
    <td
      title={title}
      className={cn(
        "border-b border-slate-100 px-2 py-1.5 text-right text-sm tabular-nums",
        emphasis ? "font-semibold text-slate-900" : "text-slate-500",
        className,
      )}
    >
      {children}
    </td>
  );
}
