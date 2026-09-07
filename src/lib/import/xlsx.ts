import { inflateRawSync } from "node:zlib";

import {
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS,
  MAX_XLSX_BYTES,
  MAX_XLSX_MB,
} from "@/lib/import/limits";

/**
 * A very small .xlsx reader.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a library
 * ---------------------------------------------------------------------------
 * The PA uploads one spreadsheet a month with nine text-and-number columns and
 * no formulas, no dates, no merged cells and no styling that matters. What that
 * needs is a ZIP reader and two XML scans - about two hundred lines - and the
 * project has no other parsing dependency to hide behind.
 *
 * The alternatives were worse rather than merely larger: the widely-known
 * `xlsx` release on npm is the pre-fork one carrying published prototype
 * pollution and ReDoS advisories, and a full workbook framework brings a
 * dependency tree and an API surface far past "read the first sheet as text"
 * for a file that is 30 KB.
 *
 * ---------------------------------------------------------------------------
 * What it does and does not do
 * ---------------------------------------------------------------------------
 * Reads the FIRST worksheet of an .xlsx and hands back its rows as strings,
 * carrying each row's real Excel row number so an error can say "row 18" and
 * mean the row the PA is looking at.
 *
 * It does not interpret number formats. A cell holding a date comes back as the
 * serial Excel stores, which is correct for this importer: every column it
 * reads is a code, a name or a unit count, and a date in one of them is an
 * error the validator should report rather than something to guess at.
 *
 * Server-only: `node:zlib` is the whole of the decompression. The file is read
 * inside a Server Action, so nothing here ships to the browser.
 *
 * ---------------------------------------------------------------------------
 * The file is untrusted
 * ---------------------------------------------------------------------------
 * It arrives from a browser upload, so every limit below is a real guard rather
 * than a formality: a 30 KB archive can inflate to gigabytes, and the entry
 * table can claim sizes the archive does not contain. Sizes are read from the
 * central directory, checked BEFORE inflating, and checked again against what
 * actually came out.
 */

// -----------------------------------------------------------------------------
// Limits
// -----------------------------------------------------------------------------

/**
 * Any single part of the archive, inflated. Guards a zip bomb.
 *
 * The only limit that lives here rather than in `limits.ts`: it is about the
 * container, and nothing outside this file has any use for it.
 */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

// -----------------------------------------------------------------------------
// The public shape
// -----------------------------------------------------------------------------

export type SheetRow = {
  /** The row number Excel shows in its own gutter. 1-based, and may skip. */
  rowNumber: number;
  /** Cell text by column index, blanks included. Never sparse. */
  cells: string[];
};

export type Worksheet = {
  /** The sheet's tab name, or `Sheet1` when the workbook does not name it. */
  name: string;
  rows: SheetRow[];
};

/**
 * A file that could not be read at all.
 *
 * Separate from a validation failure on purpose: "this is not a spreadsheet" is
 * a different message from "row 18 has an unknown HM Code", and only the second
 * is worth showing a table for.
 */
export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxReadError";
  }
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export function readXlsx(source: ArrayBuffer | Uint8Array): Worksheet {
  const bytes =
    source instanceof Uint8Array ? source : new Uint8Array(source);

  if (bytes.byteLength === 0) {
    throw new XlsxReadError("That file is empty.");
  }

  if (bytes.byteLength > MAX_XLSX_BYTES) {
    throw new XlsxReadError(`That file is larger than the ${MAX_XLSX_MB} MB limit.`);
  }

  // "PK\x03\x04". An .xls (the old binary format), a CSV renamed, or a PDF all
  // fail here rather than deeper in with a confusing message.
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new XlsxReadError(
      "That file is not an .xlsx workbook. Save it from Excel as .xlsx and upload it again.",
    );
  }

  const entries = readZipEntries(bytes);

  const sharedStringsXml = readEntryText(bytes, entries, "xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml
    ? parseSharedStringsXml(sharedStringsXml)
    : [];

  const sheet = findFirstSheet(bytes, entries);

  return {
    name: sheet.name,
    rows: parseSheetXml(sheet.xml, sharedStrings),
  };
}

// -----------------------------------------------------------------------------
// ZIP
// -----------------------------------------------------------------------------

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Everything after the compressed data starts, per the ZIP local header. */
const LOCAL_HEADER_FIXED = 30;

function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );

  // The end-of-central-directory record sits at the very end, after a comment
  // of up to 64 KB. Scanning backwards is the only way to find it.
  let eocd = -1;
  const lowest = Math.max(0, bytes.byteLength - (0xffff + 22));

  for (let at = bytes.byteLength - 22; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }

  if (eocd < 0) {
    throw new XlsxReadError("That .xlsx file is damaged and cannot be opened.");
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  if (directoryOffset === 0xffffffff || entryCount === 0xffff) {
    // ZIP64. Not produced by Excel for a file of this size, and supporting it
    // for a spreadsheet of 150 rows would be guessing at a format nobody here
    // will ever hand us.
    throw new XlsxReadError(
      "That workbook uses the ZIP64 format, which this importer cannot read. Re-save it from Excel and try again.",
    );
  }

  const entries = new Map<string, ZipEntry>();
  let at = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new XlsxReadError("That .xlsx file is damaged and cannot be opened.");
    }

    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localHeaderOffset = view.getUint32(at + 42, true);

    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );

    entries.set(name, {
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    at += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Inflates one entry to text, or `null` when the archive does not hold it. */
function readEntryText(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
  name: string,
): string | null {
  const entry = entries.get(name);

  if (!entry) {
    return null;
  }

  // Checked before a single byte is inflated: the size the archive CLAIMS is
  // what a zip bomb inflates a small entry to.
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new XlsxReadError("That workbook is too large to read.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;

  if (offset + LOCAL_HEADER_FIXED > bytes.byteLength ||
      view.getUint32(offset, true) !== LOCAL_SIGNATURE) {
    throw new XlsxReadError("That .xlsx file is damaged and cannot be opened.");
  }

  // The local header repeats the name and extra fields, and its lengths are the
  // ones that describe THIS copy - the central directory's extra field is a
  // different length, so the data offset has to be computed from here.
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + LOCAL_HEADER_FIXED + nameLength + extraLength;
  const end = start + entry.compressedSize;

  if (end > bytes.byteLength) {
    throw new XlsxReadError("That .xlsx file is damaged and cannot be opened.");
  }

  const data = bytes.subarray(start, end);

  let inflated: Uint8Array;

  if (entry.method === 0) {
    inflated = data;
  } else if (entry.method === 8) {
    try {
      inflated = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
      throw new XlsxReadError("That .xlsx file is damaged and cannot be opened.");
    }
  } else {
    throw new XlsxReadError(
      "That workbook uses a compression method this importer cannot read. Re-save it from Excel and try again.",
    );
  }

  // What actually came out, not what was promised.
  if (inflated.byteLength > MAX_ENTRY_BYTES) {
    throw new XlsxReadError("That workbook is too large to read.");
  }

  return new TextDecoder().decode(inflated);
}

// -----------------------------------------------------------------------------
// Workbook parts
// -----------------------------------------------------------------------------

/**
 * The shared string table.
 *
 * Excel writes most text once here and refers to it by index from the sheet, so
 * a sheet cell of `t="s"` holds a number that means nothing without this.
 *
 * An `<si>` can be split into several `<r>` runs when part of the text is
 * styled differently - `Alpha` in bold followed by ` HP` is one string in two
 * runs - so every `<t>` inside the entry is concatenated rather than the first
 * one taken.
 */
function parseSharedStringsXml(xml: string): string[] {
  const strings: string[] = [];
  const items = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>|<si\b[^>]*\/>/g) ?? [];

  for (const item of items) {
    const parts = item.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];

    strings.push(
      parts
        .map((part) => decodeXmlText(part.replace(/^<t\b[^>]*>|<\/t>$/g, "")))
        .join(""),
    );
  }

  return strings;
}

type SheetPart = { name: string; xml: string };

/**
 * The first worksheet, resolved the way Excel resolves it.
 *
 * `xl/worksheets/sheet1.xml` is the usual name and NOT a guarantee: the part
 * names follow the relationship ids in `xl/_rels/workbook.xml.rels`, and a
 * workbook that has had sheets added and deleted can have its first tab stored
 * as `sheet3.xml`. So the relationship is followed when it is there, and the
 * conventional name is the fallback.
 */
function findFirstSheet(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
): SheetPart {
  const workbook = readEntryText(bytes, entries, "xl/workbook.xml");
  const relationships = readEntryText(
    bytes,
    entries,
    "xl/_rels/workbook.xml.rels",
  );

  const name = workbook
    ? (readAttribute(workbook.match(/<sheet\s[^>]*>/)?.[0] ?? "", "name") ??
      "Sheet1")
    : "Sheet1";

  const candidates: string[] = [];

  if (workbook && relationships) {
    const relationshipId = readAttribute(
      workbook.match(/<sheet\s[^>]*>/)?.[0] ?? "",
      "r:id",
    );

    if (relationshipId) {
      for (const entry of relationships.match(/<Relationship\s[^>]*>/g) ?? []) {
        if (readAttribute(entry, "Id") !== relationshipId) {
          continue;
        }

        const target = readAttribute(entry, "Target");

        if (target) {
          // Targets are relative to `xl/` and occasionally absolute.
          candidates.push(
            target.startsWith("/")
              ? target.slice(1)
              : `xl/${target.replace(/^\.\//, "")}`,
          );
        }
      }
    }
  }

  candidates.push("xl/worksheets/sheet1.xml");

  for (const candidate of candidates) {
    const xml = readEntryText(bytes, entries, candidate);

    if (xml !== null) {
      return { name: decodeXmlText(name), xml };
    }
  }

  throw new XlsxReadError(
    "That workbook has no readable sheet. Re-save it from Excel and try again.",
  );
}

// -----------------------------------------------------------------------------
// The sheet
// -----------------------------------------------------------------------------

function parseSheetXml(xml: string, sharedStrings: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  const rowPattern = /<row\b([^>]*?)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g;

  let match: RegExpExecArray | null;
  let fallbackNumber = 0;

  while ((match = rowPattern.exec(xml)) !== null) {
    fallbackNumber += 1;

    if (rows.length >= MAX_SHEET_ROWS) {
      throw new XlsxReadError(
        `That sheet has more than ${MAX_SHEET_ROWS} rows, which is more than this importer will read.`,
      );
    }

    const attributes = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";

    // Excel numbers rows explicitly and may skip - a sheet whose row 7 was
    // deleted goes ...6, 8... - so the attribute is what an error message must
    // quote, never the position in this list.
    const declared = Number(readAttribute(attributes, "r"));
    const rowNumber = Number.isInteger(declared) && declared > 0
      ? declared
      : fallbackNumber;

    rows.push({ rowNumber, cells: parseCells(body, sharedStrings) });
  }

  return rows;
}

function parseCells(body: string, sharedStrings: string[]): string[] {
  const cells: string[] = [];
  const cellPattern = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;

  let match: RegExpExecArray | null;
  let nextIndex = 0;

  while ((match = cellPattern.exec(body)) !== null) {
    const attributes = match[1] ?? match[2] ?? "";
    const inner = match[3] ?? "";

    // `r="C4"` gives the column. A row omits empty cells entirely, so without
    // this a row with a blank HP CODE would shift every later column left by
    // one and quietly import the Net as the Total.
    const reference = readAttribute(attributes, "r");
    const column = reference ? columnIndex(reference) : nextIndex;
    const at = column >= 0 ? column : nextIndex;

    if (at >= MAX_SHEET_COLUMNS) {
      nextIndex = at + 1;
      continue;
    }

    while (cells.length <= at) {
      cells.push("");
    }

    cells[at] = readCellValue(attributes, inner, sharedStrings);
    nextIndex = at + 1;
  }

  return cells;
}

function readCellValue(
  attributes: string,
  inner: string,
  sharedStrings: string[],
): string {
  const type = readAttribute(attributes, "t") ?? "n";

  if (type === "inlineStr") {
    const parts = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];

    return parts
      .map((part) => decodeXmlText(part.replace(/^<t\b[^>]*>|<\/t>$/g, "")))
      .join("");
  }

  const value = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);

  if (!value) {
    return "";
  }

  const raw = decodeXmlText(value[1] ?? "");

  if (type === "s") {
    const index = Number(raw);

    return Number.isInteger(index) && index >= 0 && index < sharedStrings.length
      ? (sharedStrings[index] ?? "")
      : "";
  }

  if (type === "b") {
    return raw === "1" ? "TRUE" : "FALSE";
  }

  // "n" (number), "str" (a formula's cached string) and "e" (an error such as
  // #REF!) all come back as their own text. An error cell therefore fails the
  // importer's numeric check with the row number attached, which is a better
  // answer than silently reading it as 0.
  return raw;
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function readAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(
    new RegExp(`\\b${name}="([^"]*)"`),
  );

  return match ? (match[1] ?? null) : null;
}

/** `C4` -> 2. Returns -1 when the reference does not start with letters. */
export function columnIndex(reference: string): number {
  const letters = reference.match(/^([A-Za-z]+)/);

  if (!letters) {
    return -1;
  }

  let index = 0;

  for (const character of letters[1]!.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }

  return index - 1;
}

/**
 * XML text back to what it says.
 *
 * The five predefined entities plus numeric character references, because Excel
 * escapes anything outside its own encoding assumptions that way. `&amp;` is
 * substituted LAST so `&amp;lt;` - a literal "&lt;" typed into a cell - does
 * not come out as "<".
 */
export function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      safeCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, digits: string) =>
      safeCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : "";
}
