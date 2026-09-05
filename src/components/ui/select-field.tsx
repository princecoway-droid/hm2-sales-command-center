import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Option = {
  value: string;
  label: string;
};

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  options: readonly Option[];
  error?: string;
  hint?: string;
  /** Hide the label visually while keeping it for screen readers. */
  labelHidden?: boolean;
};

/** Labelled select, matching the styling and error wiring of `Field`. */
export function SelectField({
  label,
  name,
  options,
  error,
  hint,
  labelHidden,
  className,
  ...props
}: SelectFieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={name}
        className={cn(
          "block text-sm font-medium text-slate-700",
          labelHidden && "sr-only",
        )}
      >
        {label}
      </label>

      <select
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm",
          "ring-1 ring-inset focus:ring-2 focus:ring-inset focus:ring-sky-600",
          error ? "ring-red-400" : "ring-slate-300",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {hint ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
