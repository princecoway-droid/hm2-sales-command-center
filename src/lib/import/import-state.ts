import type { HpImportPreview } from "@/lib/import/hp-import";
import type { ActionState } from "@/lib/result";
import type { HpImportResult } from "@/lib/validation/hp";

/**
 * What the two import Server Actions hand back.
 *
 * These live here rather than beside the actions for a rule rather than a
 * preference: every export of a `"use server"` module must be an async
 * function, because each one becomes a callable server reference. An initial
 * state is a plain object, so it belongs in an ordinary module that both the
 * actions and the form can import.
 *
 * Types only and two frozen constants - no logic, no imports that reach the
 * server, so the Client Component pulls nothing into the browser bundle it does
 * not need.
 */

// -----------------------------------------------------------------------------
// Validate
// -----------------------------------------------------------------------------

export type HpImportValidateState = ActionState & {
  /** `null` until a file has been read, and whenever reading one failed. */
  preview: HpImportPreview | null;
  /** The month the preview was built for. Carried so commit cannot drift. */
  monthId: string | null;
  fileName: string | null;
};

export const initialHpImportState: HpImportValidateState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  preview: null,
  monthId: null,
  fileName: null,
};

// -----------------------------------------------------------------------------
// Commit
// -----------------------------------------------------------------------------

export type HpImportCommitState = ActionState & {
  /** `null` until an import has actually landed. */
  result: HpImportResult | null;
};

export const initialHpImportCommitState: HpImportCommitState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  result: null,
};
