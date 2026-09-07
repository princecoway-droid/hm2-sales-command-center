"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { createHmAction, updateHmAction } from "@/lib/actions/hms";
import { fieldError, initialActionState } from "@/lib/result";
import type { HM } from "@/types/models";

type HmFormProps = {
  /** Omitted when adding. */
  hm?: HM;
  onSaved: () => void;
  onCancel: () => void;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Add or edit an HM.
 *
 * One form for both, because the fields are identical and the only difference
 * is which action it posts to - two near-identical components would drift the
 * first time a field is added.
 *
 * The photo is not here on purpose. An upload needs an HM id to key the storage
 * path on, so it belongs to a record that already exists; the list offers it as
 * a separate action rather than nesting a second dialog inside this one.
 */
export function HmForm({ hm, onSaved, onCancel }: HmFormProps) {
  const isEdit = Boolean(hm);
  const [state, formAction] = useActionState(
    isEdit ? updateHmAction : createHmAction,
    initialActionState,
  );

  useEffect(() => {
    if (state.status === "success") {
      onSaved();
    }
  }, [state, onSaved]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {hm ? <input type="hidden" name="id" value={hm.id} /> : null}

      {state.status === "error" && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}

      <Field
        label="Name"
        name="name"
        defaultValue={hm?.name ?? ""}
        autoComplete="off"
        required
        error={fieldError(state, "name")}
      />

      {/* Required, unique, and validated before save. It is not a label - it is
          the key the Stage 8 Excel import matches every HP row on, so an HM
          whose code is wrong is an HM the import cannot find. */}
      <Field
        label="HM Code"
        name="hm_code"
        defaultValue={hm?.hm_code ?? ""}
        autoComplete="off"
        required
        className="font-mono uppercase"
        hint="Coway's own identifier, e.g. HM10321. Used to match the HP Excel to this HM."
        error={fieldError(state, "hm_code")}
      />

      <Field
        label="Office"
        name="office"
        defaultValue={hm?.office ?? ""}
        autoComplete="off"
        required
        error={fieldError(state, "office")}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Status"
          name="status"
          defaultValue={hm?.status ?? "active"}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          hint="Inactive HMs keep their history but drop out of the current month."
          error={fieldError(state, "status")}
        />

        <Field
          label="Display order"
          name="display_order"
          type="number"
          min={0}
          step={1}
          defaultValue={hm?.display_order ?? 0}
          hint="Lower numbers sort first."
          error={fieldError(state, "display_order")}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton label={isEdit ? "Save changes" : "Add HM"} />
      </div>
    </form>
  );
}
