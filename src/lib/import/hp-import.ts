import {
  calculateHpTotalKeyIn,
  isHpActive,
  summariseHpRows,
} from "@/lib/calculations/hp";
import { MAX_IMPORT_ROWS } from "@/lib/import/limits";
import type { SheetRow, Worksheet } from "@/lib/import/xlsx";

/**
 * The HP import, from a parsed spreadsheet to something safe to commit.
 *
 * ---------------------------------------------------------------------------
 *   upload -> readXlsx -> THIS FILE -> preview -> import_hp_month
 * ---------------------------------------------------------------------------
 *
 * Pure: no Supabase, no React, no clock. The database rows it needs to check
 * against - the HM codes, the HP codes that already exist - are handed in as a
 * context object, which is what lets the whole of the import's behaviour be
 * tested against real spreadsheets without a database.
 *
 * It never writes and never partially accepts. What comes out is either a
 * payload that the whole file passed, or a list of errors with row numbers on
 * them; there is no third state where some rows are committed and the PA is
 * told about the rest afterwards.
 *
 * ---------------------------------------------------------------------------
 * Total Key-In: two figures, one of them authoritative
 * ---------------------------------------------------------------------------
 * The spreadsheet carries its own TOTAL KEY-IN column, kept because the PA
 * reads it. This importer computes its own from W1-W4 and treats a
 * disagreement as an ERROR rather than preferring one: a mismatch means the
 * file's weeks and its total describe different months, and the honest answer
 * is to say which row and let the PA look, not to pick a winner.
 *
 * The stored figure is always the calculated one - a database CHECK refuses
 * any other - so the Excel column never becomes data.
 */

// -----------------------------------------------------------------------------
// The columns
// -----------------------------------------------------------------------------

export type HpImportField =
  | "hmCode"
  | "hpName"
  | "hpCode"
  | "w1"
  | "w2"
  | "w3"
  | "w4"
  | "excelTotalKeyIn"
  | "totalNet";

/**
 * The heading each field is looked up by, already normalised.
 *
 * The first entry is the one the PA is told to use; the rest are spellings the
 * same column has genuinely had. `ACCUMULATED NET` is accepted because that is
 * what the historical file calls it - and reading it produces a WARNING, so the
 * PA is told the column was understood as Total Net rather than left to assume.
 */
export const HP_IMPORT_HEADERS: Record<HpImportField, readonly string[]> = {
  hmCode: ["HM CODE"],
  hpName: ["HP NAME"],
  hpCode: ["HP CODE"],
  w1: ["W1 KEY IN", "W1"],
  w2: ["W2 KEY IN", "W2"],
  w3: ["W3 KEY IN", "W3"],
  w4: ["W4 KEY IN", "W4"],
  excelTotalKeyIn: ["TOTAL KEY IN"],
  totalNet: ["TOTAL NET", "ACCUMULATED NET"],
};

/** The heading shown to the PA when a column is missing. */
export const HP_IMPORT_HEADER_LABELS: Record<HpImportField, string> = {
  hmCode: "HM CODE",
  hpName: "HP NAME",
  hpCode: "HP CODE",
  w1: "W1 KEY-IN",
  w2: "W2 KEY-IN",
  w3: "W3 KEY-IN",
  w4: "W4 KEY-IN",
  excelTotalKeyIn: "TOTAL KEY-IN",
  totalNet: "TOTAL NET",
};

const FIELDS = Object.keys(HP_IMPORT_HEADERS) as HpImportField[];

/**
 * A heading, reduced to what it means.
 *
 * Case, surrounding space and punctuation all vanish, so `HM Code`,
 * ` hm  code `, `HM_CODE` and `HM-CODE` are one column. Everything that is not
 * a letter or a digit becomes a space and runs of spaces collapse, which is
 * what makes `W1 KEY-IN`, `W1 KEY IN` and `W1  Key–In` agree - including the
 * en dash Excel autocorrects a hyphen into.
 */
export function normalizeHeader(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** A code, normalised exactly as the database's own trigger normalises it. */
export function normalizeCode(text: string): string {
  return text.trim().toUpperCase();
}

/** What both `hms.hm_code` and `hps.hp_code` will accept. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,31}$/;

// -----------------------------------------------------------------------------
// What the importer needs to know about the database
// -----------------------------------------------------------------------------

export type HpImportHm = {
  id: string;
  hm_code: string;
  name: string;
};

export type HpImportContext = {
  /** Every HM, so an unknown code can be reported rather than created. */
  hms: readonly HpImportHm[];
  /** HP codes already in `hps`, so a row can be shown as NEW or UPDATE. */
  existingHpCodes: readonly string[];
};

// -----------------------------------------------------------------------------
// The preview
// -----------------------------------------------------------------------------

export type HpImportRow = {
  /** The row number Excel shows, so "row 18" means row 18 to the PA. */
  rowNumber: number;
  hmCode: string;
  /** `null` when no HM has that code - the row is an error. */
  hmId: string | null;
  hmName: string | null;
  hpCode: string;
  hpName: string;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  /** W1+W2+W3+W4. The figure that gets stored. */
  totalKeyIn: number;
  /** The spreadsheet's own column, for the cross-check. `null` when blank. */
  excelTotalKeyIn: number | null;
  totalNet: number;
  isActive: boolean;
  /** No `hps` row carries this code yet, so the import will create one. */
  isNew: boolean;
};

export type HpImportIssue = {
  /** The Excel row, or `null` for something wrong with the file as a whole. */
  rowNumber: number | null;
  /** Stable, for tests and for grouping. Never shown. */
  code: string;
  /** What the PA reads. Carries the row number and the offending value. */
  message: string;
};

export type HpImportSummary = {
  rowsDetected: number;
  hmsMatched: number;
  newHp: number;
  updatedHp: number;
  activeHp: number;
  inactiveHp: number;
};

/** One row of the payload `import_hp_month` takes. */
export type HpImportPayloadRow = {
  row_no: number;
  hm_code: string;
  hp_code: string;
  hp_name: string;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  total_key_in: number;
  total_net: number;
};

export type HpImportPreview = {
  sheetName: string;
  rows: HpImportRow[];
  summary: HpImportSummary;
  /** Anything that stops the import. Commit is refused while this is non-empty. */
  errors: HpImportIssue[];
  /** Worth saying, but not a reason to stop. */
  warnings: HpImportIssue[];
  /** False whenever there is an error, or nothing to import. */
  canCommit: boolean;
  /** Empty unless `canCommit`. Nothing half-validated is ever handed on. */
  payload: HpImportPayloadRow[];
};

export function buildHpImportPreview(
  sheet: Worksheet,
  context: HpImportContext,
): HpImportPreview {
  const errors: HpImportIssue[] = [];
  const warnings: HpImportIssue[] = [];

  const header = findHeaderRow(sheet.rows);

  if (!header) {
    return empty(sheet.name, [
      {
        rowNumber: null,
        code: "no_header",
        message:
          "No heading row was found. The sheet must have a row containing HM CODE, HP NAME and HP CODE.",
      },
    ]);
  }

  const { columns, missing, matchedHeaders } = mapColumns(header.cells);

  if (missing.length > 0) {
    return empty(sheet.name, [
      {
        rowNumber: header.rowNumber,
        code: "missing_columns",
        message: `The sheet is missing ${missing.length === 1 ? "a column" : "columns"}: ${missing
          .map((field) => HP_IMPORT_HEADER_LABELS[field])
          .join(", ")}.`,
      },
    ]);
  }

  if (matchedHeaders.totalNet === "ACCUMULATED NET") {
    warnings.push({
      rowNumber: header.rowNumber,
      code: "accumulated_net_heading",
      message:
        'The column headed "ACCUMULATED NET" was read as TOTAL NET — the month\'s Net, not a running total. Rename it to TOTAL NET in the spreadsheet when convenient.',
    });
  }

  // Matching is on the code, never the name: names change, and two HMs can
  // legitimately share one.
  const hmByCode = new Map(
    context.hms.map((hm) => [normalizeCode(hm.hm_code), hm] as const),
  );
  const existingHpCodes = new Set(
    context.existingHpCodes.map((code) => normalizeCode(code)),
  );

  const body = sheet.rows.filter((row) => row.rowNumber > header.rowNumber);
  const rows: HpImportRow[] = [];
  const seenHpCodes = new Map<string, number[]>();

  for (const row of body) {
    if (isBlankRow(row, columns)) {
      // A trailing blank row is how a spreadsheet ends, not a mistake.
      continue;
    }

    if (rows.length >= MAX_IMPORT_ROWS) {
      errors.push({
        rowNumber: row.rowNumber,
        code: "too_many_rows",
        message: `The sheet has more than ${MAX_IMPORT_ROWS} rows, which is more than one import may carry.`,
      });
      break;
    }

    rows.push(readRow(row, columns, hmByCode, existingHpCodes, errors));
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({
      rowNumber: null,
      code: "no_rows",
      message: "The sheet has a heading row but no HP rows under it.",
    });
  }

  // Duplicates are collected across the whole file rather than reported at the
  // first repeat, so the PA fixes every one of them in a single pass.
  for (const row of rows) {
    if (row.hpCode === "") {
      continue;
    }

    seenHpCodes.set(row.hpCode, [
      ...(seenHpCodes.get(row.hpCode) ?? []),
      row.rowNumber,
    ]);
  }

  for (const [code, rowNumbers] of seenHpCodes) {
    if (rowNumbers.length > 1) {
      errors.push({
        rowNumber: rowNumbers[1] ?? null,
        code: "duplicate_hp_code",
        message: `Duplicate HP Code ${code} on rows ${rowNumbers.join(", ")}. Each HP Code may appear once.`,
      });
    }
  }

  const totals = summariseHpRows(rows.map((row) => ({ totalKeyIn: row.totalKeyIn })));

  const summary: HpImportSummary = {
    rowsDetected: rows.length,
    hmsMatched: new Set(
      rows.filter((row) => row.hmId !== null).map((row) => row.hmId),
    ).size,
    newHp: rows.filter((row) => row.isNew).length,
    updatedHp: rows.filter((row) => !row.isNew).length,
    activeHp: totals.active,
    inactiveHp: totals.inactive,
  };

  const canCommit = errors.length === 0 && rows.length > 0;

  return {
    sheetName: sheet.name,
    rows,
    summary,
    errors: sortIssues(errors),
    warnings: sortIssues(warnings),
    canCommit,
    payload: canCommit ? rows.map(toPayloadRow) : [],
  };
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------

/**
 * The heading row, wherever it is.
 *
 * Not assumed to be row 1: the PA's file opens with a title and a blank line
 * above the table often enough that assuming would fail on the real one. The
 * first row carrying the three identity columns is the heading row; anything
 * above it is ignored rather than read as data.
 */
function findHeaderRow(rows: readonly SheetRow[]): SheetRow | null {
  for (const row of rows.slice(0, 25)) {
    const headings = new Set(row.cells.map(normalizeHeader));

    if (
      HP_IMPORT_HEADERS.hmCode.some((name) => headings.has(name)) &&
      HP_IMPORT_HEADERS.hpCode.some((name) => headings.has(name)) &&
      HP_IMPORT_HEADERS.hpName.some((name) => headings.has(name))
    ) {
      return row;
    }
  }

  return null;
}

type ColumnMap = Record<HpImportField, number>;

function mapColumns(cells: readonly string[]): {
  columns: ColumnMap;
  missing: HpImportField[];
  matchedHeaders: Partial<Record<HpImportField, string>>;
} {
  const normalized = cells.map(normalizeHeader);
  const columns = {} as ColumnMap;
  const matchedHeaders: Partial<Record<HpImportField, string>> = {};
  const missing: HpImportField[] = [];

  for (const field of FIELDS) {
    let found = -1;

    for (const heading of HP_IMPORT_HEADERS[field]) {
      const at = normalized.indexOf(heading);

      if (at >= 0) {
        found = at;
        matchedHeaders[field] = heading;
        break;
      }
    }

    if (found < 0) {
      missing.push(field);
      continue;
    }

    columns[field] = found;
  }

  return { columns, missing, matchedHeaders };
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

function cellAt(row: SheetRow, index: number): string {
  return (row.cells[index] ?? "").trim();
}

function isBlankRow(row: SheetRow, columns: ColumnMap): boolean {
  return FIELDS.every((field) => cellAt(row, columns[field]) === "");
}

function readRow(
  row: SheetRow,
  columns: ColumnMap,
  hmByCode: ReadonlyMap<string, HpImportHm>,
  existingHpCodes: ReadonlySet<string>,
  errors: HpImportIssue[],
): HpImportRow {
  const rowNumber = row.rowNumber;

  const hmCode = normalizeCode(cellAt(row, columns.hmCode));
  const hpCode = normalizeCode(cellAt(row, columns.hpCode));
  const hpName = cellAt(row, columns.hpName);

  if (hmCode === "") {
    errors.push(required(rowNumber, "HM Code"));
  } else if (!CODE_PATTERN.test(hmCode)) {
    errors.push({
      rowNumber,
      code: "invalid_hm_code",
      message: `Row ${rowNumber} — HM Code "${hmCode}" is not a valid code. Use letters, digits and . _ - / only, with no spaces.`,
    });
  }

  if (hpCode === "") {
    errors.push(required(rowNumber, "HP Code"));
  } else if (!CODE_PATTERN.test(hpCode)) {
    errors.push({
      rowNumber,
      code: "invalid_hp_code",
      message: `Row ${rowNumber} — HP Code "${hpCode}" is not a valid code. Use letters, digits and . _ - / only, with no spaces.`,
    });
  }

  if (hpName === "") {
    errors.push(required(rowNumber, "HP Name"));
  }

  const hm = hmCode === "" ? undefined : hmByCode.get(hmCode);

  if (hmCode !== "" && !hm) {
    // Never created. An unrecognised code is far more likely to be a typo than
    // a new hire, and inventing an HM would put somebody on the dashboard that
    // nobody added.
    errors.push({
      rowNumber,
      code: "unknown_hm_code",
      message: `Row ${rowNumber} — Unknown HM Code: ${hmCode}. Add the HM in HM Management, or correct the code in the spreadsheet.`,
    });
  }

  const w1 = readWeek(row, columns.w1, rowNumber, "W1", errors);
  const w2 = readWeek(row, columns.w2, rowNumber, "W2", errors);
  const w3 = readWeek(row, columns.w3, rowNumber, "W3", errors);
  const w4 = readWeek(row, columns.w4, rowNumber, "W4", errors);

  const totalKeyIn = calculateHpTotalKeyIn(w1, w2, w3, w4);

  const excelTotalKeyIn = readOptionalUnits(
    row,
    columns.excelTotalKeyIn,
    rowNumber,
    "Total Key-In",
    errors,
  );

  if (excelTotalKeyIn !== null && excelTotalKeyIn !== totalKeyIn) {
    errors.push({
      rowNumber,
      code: "total_key_in_mismatch",
      message: `Row ${rowNumber} — Total Key-In mismatch: the spreadsheet says ${excelTotalKeyIn}, W1–W4 add up to ${totalKeyIn}.`,
    });
  }

  const totalNet =
    readOptionalUnits(row, columns.totalNet, rowNumber, "Total Net", errors) ?? 0;

  return {
    rowNumber,
    hmCode,
    hmId: hm?.id ?? null,
    hmName: hm?.name ?? null,
    hpCode,
    hpName,
    w1,
    w2,
    w3,
    w4,
    totalKeyIn,
    excelTotalKeyIn,
    totalNet,
    isActive: isHpActive(totalKeyIn),
    isNew: hpCode !== "" && !existingHpCodes.has(hpCode),
  };
}

/**
 * One weekly Key-In cell.
 *
 * A blank week is 0 here, and ONLY here. That is not the application relaxing
 * "blank is not zero" - it is the rule the business states for this dataset:
 * the spreadsheet is a complete record of the month, so an HP with nothing in
 * W3 sold nothing in W3.
 */
function readWeek(
  row: SheetRow,
  column: number,
  rowNumber: number,
  label: string,
  errors: HpImportIssue[],
): number {
  return readOptionalUnits(row, column, rowNumber, label, errors) ?? 0;
}

/** A unit count, or `null` for a blank cell. Anything else is an error. */
function readOptionalUnits(
  row: SheetRow,
  column: number,
  rowNumber: number,
  label: string,
  errors: HpImportIssue[],
): number | null {
  const text = cellAt(row, column);

  if (text === "") {
    return null;
  }

  // Thousands separators and stray spaces are what a hand-maintained
  // spreadsheet actually contains; a letter is not.
  const cleaned = text.replace(/[\s,]/g, "");
  const value = Number(cleaned);

  if (cleaned === "" || !Number.isFinite(value)) {
    errors.push({
      rowNumber,
      code: "not_a_number",
      message: `Row ${rowNumber} — ${label} is "${text}", which is not a number.`,
    });
    return null;
  }

  if (!Number.isInteger(value)) {
    // `5.0` is 5; `5.5` is half a unit, which does not exist.
    errors.push({
      rowNumber,
      code: "not_a_whole_number",
      message: `Row ${rowNumber} — ${label} is ${text}. Units are whole numbers.`,
    });
    return null;
  }

  if (value < 0) {
    errors.push({
      rowNumber,
      code: "negative",
      message: `Row ${rowNumber} — ${label} is ${text}. It cannot be negative.`,
    });
    return null;
  }

  return value;
}

function required(rowNumber: number, label: string): HpImportIssue {
  return {
    rowNumber,
    code: "missing_value",
    message: `Row ${rowNumber} — ${label} is required.`,
  };
}

// -----------------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------------

function toPayloadRow(row: HpImportRow): HpImportPayloadRow {
  return {
    row_no: row.rowNumber,
    hm_code: row.hmCode,
    hp_code: row.hpCode,
    hp_name: row.hpName,
    w1: row.w1,
    w2: row.w2,
    w3: row.w3,
    w4: row.w4,
    total_key_in: row.totalKeyIn,
    total_net: row.totalNet,
  };
}

/** File-level problems first, then by row. The PA reads them in file order. */
function sortIssues(issues: readonly HpImportIssue[]): HpImportIssue[] {
  return [...issues].sort((a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0));
}

function empty(sheetName: string, errors: HpImportIssue[]): HpImportPreview {
  return {
    sheetName,
    rows: [],
    summary: {
      rowsDetected: 0,
      hmsMatched: 0,
      newHp: 0,
      updatedHp: 0,
      activeHp: 0,
      inactiveHp: 0,
    },
    errors,
    warnings: [],
    canCommit: false,
    payload: [],
  };
}
