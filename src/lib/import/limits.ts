/**
 * Limits the upload screen and the reader both have to know.
 *
 * A separate module with NO imports at all, because both sides need these and
 * they live on opposite sides of the server boundary: `xlsx.ts` reaches for
 * `node:zlib`, and the upload form is a Client Component. A client importing
 * the reader just to read a number would pull a Node built-in into the browser
 * bundle.
 */

/** Far past a monthly HP file, and small enough to hold in memory safely. */
export const MAX_XLSX_BYTES = 5 * 1024 * 1024;

/** The same figure, for a sentence. */
export const MAX_XLSX_MB = Math.round(MAX_XLSX_BYTES / (1024 * 1024));

/** Rows read from the sheet, header included. */
export const MAX_SHEET_ROWS = 5000;

/** Columns read per row. The importer needs nine. */
export const MAX_SHEET_COLUMNS = 64;

/**
 * How many rows one import may carry.
 *
 * Matches the ceiling `import_hp_month` enforces in SQL, so the preview and the
 * database refuse the same file rather than the PA discovering the real limit
 * on commit.
 */
export const MAX_IMPORT_ROWS = 5000;
