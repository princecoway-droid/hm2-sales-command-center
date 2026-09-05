"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select-field";
import { createMonthAction } from "@/lib/actions/months";
import {
  findCurrentMonth,
  findMonthNeighbours,
  monthLabel,
  sortMonthsAscending,
} from "@/lib/calendar";
import { fieldError, initialActionState } from "@/lib/result";
import { ROUTES } from "@/lib/routes";
import { MONTH_NAMES, deriveQuarter } from "@/lib/validation/month";
import type { Month } from "@/types/models";

type MonthSelectorProps = {
  months: readonly Month[];
  selected: Month | null;
  /** Asked about before navigating away, so a month switch cannot lose edits. */
  hasUnsavedChanges: boolean;
};

/**
 * Picks the reporting month everything else on the page is scoped to.
 *
 * Switching month is a navigation, not local state: the whole screen is
 * re-fetched for the new `month_id`, so there is no path by which one section
 * can still be showing August while another shows September.
 *
 * Previous and Next step through the months that actually exist rather than
 * doing calendar arithmetic - a month nobody has opened has nothing to show, so
 * the control is disabled instead of leading somewhere empty.
 */
export function MonthSelector({
  months,
  selected,
  hasUnsavedChanges,
}: MonthSelectorProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const { previous, next } = selected
    ? findMonthNeighbours(months, selected.id)
    : { previous: null, next: null };
  const current = findCurrentMonth(months);

  function goTo(month: Month | null) {
    if (!month || month.id === selected?.id) {
      return;
    }

    if (
      hasUnsavedChanges &&
      !window.confirm(
        "You have unsaved changes on this month. Leave without saving?",
      )
    ) {
      return;
    }

    router.push(`${ROUTES.dataEntry}?month=${month.id}`);
  }

  const options = sortMonthsAscending(months)
    .reverse()
    .map((month) => ({
      value: month.id,
      label: `${monthLabel(month)}  ·  Q${month.quarter}`,
    }));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-56">
        <SelectField
          label="Reporting month"
          name="month"
          value={selected?.id ?? ""}
          options={
            options.length > 0
              ? options
              : [{ value: "", label: "No months yet" }]
          }
          disabled={options.length === 0}
          onChange={(event) => {
            const month = months.find((m) => m.id === event.target.value);
            goTo(month ?? null);
          }}
        />
      </div>

      <div className="flex items-center gap-1.5 pb-0.5">
        <Button
          variant="secondary"
          onClick={() => goTo(previous)}
          disabled={!previous}
          title={previous ? monthLabel(previous) : "No earlier month has been opened"}
        >
          ← Previous
        </Button>
        <Button
          variant="secondary"
          onClick={() => goTo(current)}
          disabled={!current || current.id === selected?.id}
          title={
            current
              ? monthLabel(current)
              : "This month has not been opened yet"
          }
        >
          Current
        </Button>
        <Button
          variant="secondary"
          onClick={() => goTo(next)}
          disabled={!next}
          title={next ? monthLabel(next) : "No later month has been opened"}
        >
          Next →
        </Button>
      </div>

      <div className="pb-0.5">
        <Button variant="ghost" onClick={() => setIsCreating(true)}>
          + New month
        </Button>
      </div>

      <Modal
        open={isCreating}
        title="Open a reporting month"
        description="The quarter and label are derived — you only choose year and month."
        onClose={() => setIsCreating(false)}
      >
        {isCreating ? (
          <NewMonthForm
            onCreated={() => {
              setIsCreating(false);
              router.refresh();
            }}
            onCancel={() => setIsCreating(false)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Opening…" : "Open month"}
    </Button>
  );
}

function NewMonthForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(
    createMonthAction,
    initialActionState,
  );
  const today = new Date();
  const [year, setYear] = useState(String(today.getFullYear()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));

  useEffect(() => {
    if (state.status === "success") {
      onCreated();
    }
  }, [state, onCreated]);

  const parsedMonth = Number(month);
  const preview =
    Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? `${MONTH_NAMES[parsedMonth - 1]} ${year} · Q${deriveQuarter(parsedMonth)}`
      : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Month"
          name="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          options={MONTH_NAMES.map((name, index) => ({
            value: String(index + 1),
            label: name,
          }))}
          error={fieldError(state, "month")}
        />

        <Field
          label="Year"
          name="year"
          type="number"
          min={2000}
          max={2100}
          step={1}
          value={year}
          onChange={(event) => setYear(event.target.value)}
          error={fieldError(state, "year")}
        />
      </div>

      {preview ? (
        <p className="text-sm text-slate-500">
          Will be created as{" "}
          <span className="font-medium text-slate-900">{preview}</span>.
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton />
      </div>
    </form>
  );
}
