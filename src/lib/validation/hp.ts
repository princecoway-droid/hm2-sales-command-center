import { z } from "zod";

import { MAX_IMPORT_ROWS } from "@/lib/import/limits";
import { naturalNumber, requiredText, uuid } from "@/lib/validation/utils";

/**
 * The HP import payload.
 *
 * Mirrors the constraints on `hps` and `hp_monthly_performance`, and the checks
 * `import_hp_month` runs. Three layers say the same thing on purpose:
 *
 *   the preview   so the PA sees which row is wrong before anything happens
 *   this schema   so a Server Action reached by direct POST cannot skip it
 *   the function  so a direct call to PostgREST cannot skip THAT
 *
 * Only the last one is the boundary. The other two exist so the PA gets a
 * message instead of a 400.
 */

/** Codes are uppercased and trimmed before they get here, exactly as in SQL. */
const code = (label: string) =>
  requiredText(label, 32).regex(
    /^[A-Z0-9][A-Z0-9._/-]{0,31}$/,
    `${label} may use letters, digits and . _ - / only, with no spaces.`,
  );

export const hpImportRowSchema = z.object({
  /** The Excel row, carried so a database rejection can name it. */
  row_no: z.number().int().min(1),
  hm_code: code("HM Code"),
  hp_code: code("HP Code"),
  hp_name: requiredText("HP Name", 160),
  w1: naturalNumber("W1 Key-In"),
  w2: naturalNumber("W2 Key-In"),
  w3: naturalNumber("W3 Key-In"),
  w4: naturalNumber("W4 Key-In"),
  total_key_in: naturalNumber("Total Key-In"),
  total_net: naturalNumber("Total Net"),
});

export type HpImportRowInput = z.infer<typeof hpImportRowSchema>;

export const hpImportCommitSchema = z.object({
  month_id: uuid("Month"),
  file_name: requiredText("File name", 255),
  rows: z
    .array(hpImportRowSchema)
    .min(1, "There is nothing to import.")
    .max(MAX_IMPORT_ROWS, `An import may carry at most ${MAX_IMPORT_ROWS} rows.`),
});

export type HpImportCommitInput = z.infer<typeof hpImportCommitSchema>;

/**
 * The result `import_hp_month` returns, narrowed.
 *
 * Structural rather than a cast: what comes back is whatever the database sent,
 * and this is the one place it becomes a typed value.
 */
export type HpImportResult = {
  monthId: string;
  rowsProcessed: number;
  newHp: number;
  updatedHp: number;
  activeHp: number;
  inactiveHp: number;
};

export function parseHpImportResult(data: unknown): HpImportResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const raw = data as Record<string, unknown>;
  const monthId = raw.month_id;

  if (typeof monthId !== "string") {
    return null;
  }

  const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  return {
    monthId,
    rowsProcessed: count(raw.rows_processed),
    newHp: count(raw.new_hp_count),
    updatedHp: count(raw.updated_hp_count),
    activeHp: count(raw.active_hp_count),
    inactiveHp: count(raw.inactive_hp_count),
  };
}
