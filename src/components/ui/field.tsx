import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
};

/** Labelled input with inline error text, wired up for screen readers. */
export function Field({
  label,
  name,
  error,
  hint,
  className,
  ...props
}: FieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={name}
        className="block text-sm font-medium text-slate-700"
      >
        {label}
      </label>

      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "block w-full rounded-md border-0 px-3 py-2 text-sm text-slate-900 shadow-sm",
          "ring-1 ring-inset placeholder:text-slate-400",
          "focus:ring-2 focus:ring-inset focus:ring-sky-600",
          error ? "ring-red-400" : "ring-slate-300",
          className,
        )}
        {...props}
      />

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
