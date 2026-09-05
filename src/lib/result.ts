/**
 * Shared result shapes for Server Actions and data access.
 *
 * Two patterns, used consistently across the app:
 *
 *   `ActionState`  what a Server Action hands back to `useActionState`. Always
 *                  returned, never thrown, so a form can show a field-level
 *                  error without unmounting.
 *
 *   `Result<T>`    what the data layer returns. Read paths hand back a typed
 *                  error instead of throwing, so a page can render a degraded
 *                  state (Supabase unreachable, not configured yet) rather than
 *                  falling over into an error boundary.
 */

// -----------------------------------------------------------------------------
// Server Action state
// -----------------------------------------------------------------------------

export type FieldErrors = Record<string, string[]>;

export type ActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: FieldErrors;
};

export const initialActionState: ActionState = {
  status: "idle",
  message: null,
  fieldErrors: {},
};

export function success(message: string | null = null): ActionState {
  return { status: "success", message, fieldErrors: {} };
}

export function failure(
  message: string,
  fieldErrors: FieldErrors = {},
): ActionState {
  return { status: "error", message, fieldErrors };
}

/** First error for a field, or undefined. Convenience for rendering. */
export function fieldError(
  state: ActionState,
  field: string,
): string | undefined {
  return state.fieldErrors[field]?.[0];
}

// -----------------------------------------------------------------------------
// Data access result
// -----------------------------------------------------------------------------

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
