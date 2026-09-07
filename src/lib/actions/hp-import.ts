"use server";

import { revalidatePath } from "next/cache";

import { requirePaOrManager } from "@/lib/auth/session";
import { mapDatabaseError } from "@/lib/errors";
import {
  buildHpImportPreview,
  type HpImportPreview,
} from "@/lib/import/hp-import";
import type {
  HpImportCommitState,
  HpImportValidateState,
} from "@/lib/import/import-state";
import { MAX_XLSX_BYTES, MAX_XLSX_MB } from "@/lib/import/limits";
import { readXlsx, XlsxReadError } from "@/lib/import/xlsx";
import { getHpImportContext } from "@/lib/data/hp";
import { failure, success } from "@/lib/result";
import { ROUTES } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  hpImportCommitSchema,
  parseHpImportResult,
  type HpImportCommitInput,
} from "@/lib/validation/hp";
import { uuid } from "@/lib/validation/utils";

/**
 * The HP import, in two steps that never blur into one.
 *
 *   validateHpImportAction   reads the file, checks every row, returns a
 *                            PREVIEW. Writes nothing, ever.
 *   commitHpImportAction     sends the validated rows to `import_hp_month`,
 *                            which applies them in one transaction.
 *
 * The split is the point. A PA is about to overwrite a month's figures from a
 * spreadsheet they maintain by hand, and the thing they need before that
 * happens is to SEE what it will do - how many HPs are new, which HM each row
 * mapped to, and every row that is wrong, all at once.
 *
 * Neither action is a boundary. `import_hp_month` re-runs every check as the
 * caller under RLS, so a direct POST to either of these - or straight to
 * PostgREST - meets the same rules. What these buy is the message: "row 18 —
 * unknown HM Code HM99999" instead of a database error.
 */

// -----------------------------------------------------------------------------
// Validate
// -----------------------------------------------------------------------------

// Every export of a `"use server"` module has to be an async function, so the
// state shapes and their initial values live in `lib/import/import-state.ts`.
// Only the two actions are exported from here.

function validateFailure(message: string): HpImportValidateState {
  return {
    ...failure(message),
    preview: null,
    monthId: null,
    fileName: null,
  };
}

export async function validateHpImportAction(
  _prevState: HpImportValidateState,
  formData: FormData,
): Promise<HpImportValidateState> {
  await requirePaOrManager();

  const month = uuid("Month").safeParse(formData.get("month_id"));

  if (!month.success) {
    return validateFailure("Choose the reporting month to import into.");
  }

  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return validateFailure("Choose an .xlsx file to import.");
  }

  // Checked before the bytes are read into memory, not after.
  if (file.size > MAX_XLSX_BYTES) {
    return validateFailure(`That file is larger than the ${MAX_XLSX_MB} MB limit.`);
  }

  const contextResult = await getHpImportContext();

  if (!contextResult.ok) {
    return validateFailure(contextResult.error);
  }

  let preview: HpImportPreview;

  try {
    const sheet = readXlsx(await file.arrayBuffer());
    preview = buildHpImportPreview(sheet, contextResult.data);
  } catch (error) {
    // A file that cannot be opened at all is a different message from a file
    // whose row 18 is wrong, and only the second is worth a table.
    if (error instanceof XlsxReadError) {
      return validateFailure(error.message);
    }

    console.error("[hp-import] parse failed:", error);

    return validateFailure(
      "That file could not be read. Re-save it from Excel as .xlsx and try again.",
    );
  }

  const base: HpImportValidateState = {
    ...(preview.canCommit
      ? success(
          `${preview.summary.rowsDetected} row${preview.summary.rowsDetected === 1 ? "" : "s"} checked. Review the preview, then import.`,
        )
      : failure(
          preview.errors.length === 1
            ? "1 problem was found. Nothing has been imported."
            : `${preview.errors.length} problems were found. Nothing has been imported.`,
        )),
    preview,
    monthId: month.data,
    fileName: file.name,
  };

  return base;
}

// -----------------------------------------------------------------------------
// Commit
// -----------------------------------------------------------------------------

function commitFailure(message: string): HpImportCommitState {
  return { ...failure(message), result: null };
}

/**
 * Applies a validated import.
 *
 * One RPC, one transaction. There is deliberately no loop here and no second
 * statement: everything the import does - creating HPs, rewriting the month,
 * recording the run - happens inside `import_hp_month`, which is what makes
 * "no partial import" a property of the database rather than of this function
 * remembering to roll something back.
 */
export async function commitHpImportAction(
  input: HpImportCommitInput,
): Promise<HpImportCommitState> {
  await requirePaOrManager();

  const parsed = hpImportCommitSchema.safeParse(input);

  if (!parsed.success) {
    return commitFailure(
      "Those rows could not be imported. Upload the file again and check the preview.",
    );
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("import_hp_month", {
    p_month_id: parsed.data.month_id,
    p_file_name: parsed.data.file_name,
    p_rows: parsed.data.rows,
  });

  if (error) {
    const mapped = mapDatabaseError(error);
    return commitFailure(mapped.message);
  }

  const result = parseHpImportResult(data);

  if (!result) {
    return commitFailure(
      "The import ran but did not report what it did. Check the HP listing before importing again.",
    );
  }

  // Active HP on both dashboards is derived from what was just written, so both
  // are refreshed - not only the page the PA is standing on.
  revalidatePath(ROUTES.hpImport);
  revalidatePath(ROUTES.hpListing);
  revalidatePath(ROUTES.dashboard);
  revalidatePath(ROUTES.dataEntry);

  return {
    ...success(
      `${result.rowsProcessed} row${result.rowsProcessed === 1 ? "" : "s"} imported.`,
    ),
    result,
  };
}
