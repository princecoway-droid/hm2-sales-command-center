import { deflateRawSync } from "node:zlib";

/**
 * A minimal .xlsx WRITER, for tests only.
 *
 * The reader in `src/lib/import/xlsx.ts` is the thing under test, and a test
 * that fed it a hand-written XML string would prove nothing about the format:
 * the interesting failures are in the ZIP container, the shared string table
 * and the sparse cell layout, none of which a fixture string has.
 *
 * So a test builds a real workbook here - a real ZIP with real deflate, real
 * `xl/sharedStrings.xml` and cells addressed by `r="C4"` - and hands it to the
 * reader as bytes. What comes back out is then a round trip through the actual
 * format rather than through an agreement between two of our own functions.
 *
 * Deliberately a fixture, not a feature. Nothing in `src/` writes .xlsx, and
 * nothing should: the PA's spreadsheet is an input.
 */

export type SheetSpec = {
  name?: string;
  /**
   * Rows of cell text. `null` writes NO cell for that column - which is what
   * Excel does with an empty cell, and the case that shifts every later column
   * left if a reader is not addressing cells by their `r` reference.
   */
  rows: readonly (readonly (string | number | null)[])[];
  /** Excel row numbers, when the sheet should have gaps. Defaults to 1..n. */
  rowNumbers?: readonly number[];
};

// -----------------------------------------------------------------------------
// The workbook
// -----------------------------------------------------------------------------

export function buildXlsx(spec: SheetSpec): Uint8Array {
  const sheetName = spec.name ?? "HP";

  // Text goes through the shared string table exactly as Excel writes it;
  // numbers stay inline. That is what makes `t="s"` and the index lookup real
  // rather than a path the fixture never takes.
  const shared: string[] = [];
  const indexOf = (value: string): number => {
    const existing = shared.indexOf(value);

    if (existing >= 0) {
      return existing;
    }

    shared.push(value);
    return shared.length - 1;
  };

  const rowsXml = spec.rows
    .map((cells, rowIndex) => {
      const rowNumber = spec.rowNumbers?.[rowIndex] ?? rowIndex + 1;

      const cellsXml = cells
        .map((value, columnIndex) => {
          if (value === null) {
            return "";
          }

          const reference = `${columnName(columnIndex)}${rowNumber}`;

          if (typeof value === "number") {
            return `<c r="${reference}"><v>${value}</v></c>`;
          }

          return `<c r="${reference}" t="s"><v>${indexOf(value)}</v></c>`;
        })
        .join("");

      return `<row r="${rowNumber}">${cellsXml}</row>`;
    })
    .join("");

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowsXml}</sheetData></worksheet>`;

  const sharedXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join("") +
    `</sst>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  // The first sheet is stored under a name that is NOT `sheet1.xml`, so a
  // reader that guesses the conventional name instead of following the
  // relationship fails this fixture.
  const relsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>` +
    `</Relationships>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="xml" ContentType="application/xml"/></Types>`;

  return buildZip([
    { name: "[Content_Types].xml", text: contentTypes, deflate: false },
    { name: "xl/workbook.xml", text: workbookXml, deflate: false },
    { name: "xl/_rels/workbook.xml.rels", text: relsXml, deflate: false },
    { name: "xl/sharedStrings.xml", text: sharedXml, deflate: true },
    { name: "xl/worksheets/sheet4.xml", text: sheetXml, deflate: true },
  ]);
}

/** `0` -> "A", `26` -> "AA". */
export function columnName(index: number): string {
  let name = "";
  let value = index;

  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  }

  return name;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// -----------------------------------------------------------------------------
// ZIP
// -----------------------------------------------------------------------------

type ZipInput = { name: string; text: string; deflate: boolean };

/**
 * A ZIP with both storage methods in it.
 *
 * Stored entries and deflated entries in the same archive on purpose: the
 * reader has a branch for each, and an archive that only used one would leave
 * half of it unexercised.
 */
function buildZip(inputs: readonly ZipInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];

  let offset = 0;

  for (const input of inputs) {
    const name = encoder.encode(input.name);
    const raw = encoder.encode(input.text);
    const data = input.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = input.deflate ? 8 : 0;
    const crc = crc32(raw);

    const header = new Uint8Array(30 + name.length);
    const headerView = new DataView(header.buffer);

    headerView.setUint32(0, 0x04034b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 0, true);
    headerView.setUint16(8, method, true);
    headerView.setUint32(14, crc, true);
    headerView.setUint32(18, data.length, true);
    headerView.setUint32(22, raw.length, true);
    headerView.setUint16(26, name.length, true);
    header.set(name, 30);

    locals.push(header, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    centrals.push(central);

    offset += header.length + data.length;
  }

  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, inputs.length, true);
  endView.setUint16(10, inputs.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  return concat([...locals, ...centrals, end]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);

  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;

    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
