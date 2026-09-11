"use client";

import { cn } from "@/lib/utils";

type GroupShiInputProps = {
  value: string;
  onChange: (text: string) => void;
  error?: string;
};

/**
 * The group SHI figure.
 *
 * Keyed in directly from Coway eTrust, exactly as published. It is deliberately
 * NOT derived from the HM SHI column - not an average, not a weighted average,
 * not a total. eTrust calculates it its own way, and any formula invented here
 * would quietly disagree with the number the business actually reports.
 *
 * It sits beside the grid rather than in it because it belongs to the month, not
 * to any HM.
 */
export function GroupShiInput({ value, onChange, error }: GroupShiInputProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor="group-shi"
        className="block text-sm font-medium text-slate-700"
      >
        Group SHI
      </label>

      <div className="flex items-center gap-2">
        <input
          id="group-shi"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder="—"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "group-shi-error" : "group-shi-hint"}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "w-28 rounded-md border-0 px-3 py-2 text-right text-sm tabular-nums text-slate-900 shadow-sm",
            "ring-1 ring-inset focus:ring-2 focus:ring-inset focus:ring-sky-600",
            error ? "ring-red-400" : "ring-slate-300",
          )}
        />
        <span className="text-sm text-slate-500">%</span>
      </div>

      {error ? (
        <p id="group-shi-error" className="text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : (
        <p id="group-shi-hint" className="text-xs text-slate-500">
          Entered from eTrust. Never calculated from the HM SHI column.
        </p>
      )}
    </div>
  );
}
