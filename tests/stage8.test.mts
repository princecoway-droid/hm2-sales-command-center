/**
 * Stage 8 tests: HP-level import, Active HP, and the HP listing.
 *
 *   npm run test:stage8
 *
 * Same shape as Stages 1-6 - plain Node, no framework, one file, the Stage 3
 * fixtures reused where a scenario is about the engine rather than about SQL.
 *
 * ---------------------------------------------------------------------------
 * What is being tested, and what deliberately is not
 * ---------------------------------------------------------------------------
 * NOT the dashboard formulas again: Achievement, Net Ratio, the totals, the
 * bands and the ranking are proved against the engine in `stage3.test.mts`.
 *
 * What IS tested here is what this stage can uniquely get wrong:
 *
 *   the FILE      a real .xlsx, built by `tests/xlsx-fixture.mts` and read back
 *                 through the real reader. Sparse cells, shared strings,
 *                 deflate, a heading row that is not row 1, and the row numbers
 *                 an error message has to quote.
 *
 *   the RULES     Total Key-In is W1-W4 and the spreadsheet's own column is a
 *                 cross-check; an unknown HM Code is refused rather than
 *                 created; a duplicate HP Code is refused rather than merged.
 *
 *   the COMMIT    against a REAL Postgres, that an import lands completely or
 *                 not at all, touches one month, and never deletes an HP that
 *                 simply was not in this month's file.
 *
 *   ACTIVE HP     that it is COUNTED from those rows and read from nowhere
 *                 else - including that the deprecated
 *                 `hm_monthly_performance.active_hp` column can hold a
 *                 contradictory figure without changing a single number on
 *                 screen.
 *
 *   the BOUNDARY  that `anon` cannot reach an HP row, that a PA can import but
 *                 not delete, and that the import function is not
 *                 SECURITY DEFINER.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

import {
  buildHmMonthInputs,
  calculateGroupMonthlyPerformance,
  calculateHmMonthlyPerformances,
  calculateHpTotalKeyIn,
  hpActiveEntry,
  isHpActive,
  summariseHpRows,
  toMonthInput,
  toSalesWeekInput,
  HP_ACTIVE_THRESHOLD,
} from "@/lib/calculations";
import {
  buildHpImportPreview,
  normalizeCode,
  normalizeHeader,
  type HpImportContext,
} from "@/lib/import/hp-import";
import { readXlsx, XlsxReadError } from "@/lib/import/xlsx";
import {
  hpImportPath,
  hpListingPath,
  isPublicRoute,
  navItemsForRole,
  shareHmHpPath,
  shareHmPath,
  sharePath,
  PUBLIC_ROUTES,
  ROUTES,
} from "@/lib/routes";
import { hpImportCommitSchema, parseHpImportResult } from "@/lib/validation/hp";
import { buildShareHmDetail, parseShareHmPayload } from "@/lib/share/resolve-hm";
import { buildShareHpList, parseShareHpPayload } from "@/lib/share/resolve-hp";
import { buildDashboardViewModel } from "@/lib/view-models/dashboard";
import { buildHmDetailViewModel } from "@/lib/view-models/hm-detail";
import { buildHpListingViewModel } from "@/lib/view-models/hp-listing";
import {
  buildHmPerformanceViewModel,
  buildMonthlyPerformanceViewModel,
} from "@/lib/view-models/monthly-performance";
import type { HpListing } from "@/lib/data/hp";
import type { HM, Month } from "@/types/models";

import { buildXlsx } from "./xlsx-fixture.mts";
import {
  SEPTEMBER_WEEKS,
  buildMonthRecords,
  createRoster,
  hmId,
  rosterList,
  type Roster,
} from "./fixtures.mts";

let pass = 0;
let fail = 0;

const check = (name: string, ok: boolean, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

const section = (title: string) => console.log(`\n${title}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "src");
const SUPABASE = path.resolve(HERE, "..", "supabase");

const read = (relative: string) =>
  readFileSync(path.join(SRC, relative), "utf8");

// =============================================================================
section("[S8-A] Total Key-In and the active threshold");
// =============================================================================

check(
  "Total Key-In is W1+W2+W3+W4",
  calculateHpTotalKeyIn(3, 0, 5, 2) === 10,
);

check(
  "a blank weekly cell counts as 0 for the monthly total",
  calculateHpTotalKeyIn(3, null, 5, null) === 8,
);

check(
  "every week blank makes a Total Key-In of 0",
  calculateHpTotalKeyIn(null, null, null, null) === 0,
);

check(
  "an undefined week is treated the same as a blank one",
  calculateHpTotalKeyIn(2, undefined, undefined, undefined) === 2,
);

check("the active threshold is 1", HP_ACTIVE_THRESHOLD === 1);
check("Total Key-In 0 is INACTIVE", !isHpActive(0));
check("Total Key-In 1 is ACTIVE", isHpActive(1));
check("Total Key-In 2 is ACTIVE", isHpActive(2));

{
  const totals = summariseHpRows([
    { totalKeyIn: 0 },
    { totalKeyIn: 1 },
    { totalKeyIn: 14 },
    { totalKeyIn: 0 },
  ]);

  check(
    "a set of rows counts active and inactive, and they come to the total",
    totals.total === 4 &&
      totals.active === 2 &&
      totals.inactive === 2 &&
      totals.active + totals.inactive === totals.total,
  );
}

// The distinction the whole feature turns on.
check(
  "no HP record at all is a BLANK Active HP, not zero",
  hpActiveEntry(undefined) === null && hpActiveEntry(null) === null,
);

check(
  "HP rows with none of them active is a real, entered ZERO",
  hpActiveEntry({ hm_id: "x", hp_count: 12, active_hp: 0 }) === 0,
);

check(
  "and a count comes through as itself",
  hpActiveEntry({ hm_id: "x", hp_count: 12, active_hp: 9 }) === 9,
);

// =============================================================================
section("[S8-B] reading a real .xlsx");
// =============================================================================

/** A token-shaped string for the link assertions. Never a real one. */
const PUBLIC_TOKEN = "s8ShareTokenForLinkAssertionsOnly_0123456789";

const HEADER = [
  "HM CODE",
  "HP NAME",
  "HP CODE",
  "W1 KEY-IN",
  "W2 KEY-IN",
  "W3 KEY-IN",
  "W4 KEY-IN",
  "TOTAL KEY-IN",
  "TOTAL NET",
];

{
  const bytes = buildXlsx({
    name: "September",
    rows: [
      HEADER,
      ["HM10321", "Sample HP Alpha", "HP001", 3, null, 5, 2, 10, 8],
      ["HM10322", "Sample HP <Beta> & Co", "HP002", null, null, null, null, 0, 0],
    ],
    // Row 3 was deleted in Excel, so the second HP row is row 4. An error about
    // it has to say 4.
    rowNumbers: [1, 2, 4],
  });

  const sheet = readXlsx(bytes);

  check("the first worksheet is found through its relationship", sheet.name === "September");
  check("every row comes back", sheet.rows.length === 3);
  check(
    "Excel's own row numbers are kept, gaps included",
    sheet.rows.map((row) => row.rowNumber).join(",") === "1,2,4",
    sheet.rows.map((row) => row.rowNumber).join(","),
  );
  check(
    "a blank cell keeps its column - the row does not shift left",
    sheet.rows[1]!.cells.join("|") ===
      "HM10321|Sample HP Alpha|HP001|3||5|2|10|8",
    sheet.rows[1]!.cells.join("|"),
  );
  check(
    "XML entities are decoded back to what the cell says",
    sheet.rows[2]!.cells[1] === "Sample HP <Beta> & Co",
    sheet.rows[2]!.cells[1],
  );
}

{
  let message = "";

  try {
    readXlsx(new TextEncoder().encode("HM CODE,HP NAME\nHM1,Alpha\n"));
  } catch (error) {
    message = error instanceof XlsxReadError ? error.message : "wrong type";
  }

  check(
    "a CSV renamed .xlsx is refused with something a PA can act on",
    message.includes("not an .xlsx workbook"),
    message,
  );
}

{
  let refused = false;

  try {
    readXlsx(new Uint8Array(0));
  } catch (error) {
    refused = error instanceof XlsxReadError;
  }

  check("an empty file is refused", refused);
}

// =============================================================================
section("[S8-C] header normalisation");
// =============================================================================

check(
  "case, surrounding space and punctuation all collapse",
  normalizeHeader("  hm code  ") === "HM CODE" &&
    normalizeHeader("HM_Code") === "HM CODE" &&
    normalizeHeader("HM-CODE") === "HM CODE",
);

check(
  "W1 KEY-IN, W1 KEY IN and W1 Key_In are one column",
  normalizeHeader("W1 KEY-IN") === "W1 KEY IN" &&
    normalizeHeader("W1 KEY IN") === "W1 KEY IN" &&
    normalizeHeader("W1 Key_In") === "W1 KEY IN",
);

check(
  "a code is normalised the way the database's trigger normalises it",
  normalizeCode("  hm10321 ") === "HM10321",
);

// =============================================================================
section("[S8-D] validating a file");
// =============================================================================

const CONTEXT: HpImportContext = {
  hms: [
    { id: "hm-alpha", hm_code: "HM10321", name: "Sample HM Alpha" },
    { id: "hm-bravo", hm_code: "HM10322", name: "Sample HM Bravo" },
  ],
  existingHpCodes: ["HP002"],
};

const previewOf = (
  rows: readonly (readonly (string | number | null)[])[],
  context: HpImportContext = CONTEXT,
) => buildHpImportPreview(readXlsx(buildXlsx({ rows })), context);

{
  const preview = previewOf([
    HEADER,
    ["hm10321", "  Sample HP Alpha  ", "hp001", 3, null, 5, 2, 10, 8],
    ["HM10322", "Sample HP Beta", "HP002", null, null, null, null, 0, 4],
  ]);

  check("a clean file has no errors", preview.errors.length === 0, JSON.stringify(preview.errors));
  check("and may be committed", preview.canCommit);

  check(
    "the summary counts rows, HMs, new and existing HPs",
    preview.summary.rowsDetected === 2 &&
      preview.summary.hmsMatched === 2 &&
      preview.summary.newHp === 1 &&
      preview.summary.updatedHp === 1,
    JSON.stringify(preview.summary),
  );

  check(
    "Active HP is counted from Total Key-In, not asked for",
    preview.summary.activeHp === 1 && preview.summary.inactiveHp === 1,
    JSON.stringify(preview.summary),
  );

  const alpha = preview.rows[0]!;

  check(
    "codes are uppercased and names trimmed on the way in",
    alpha.hmCode === "HM10321" &&
      alpha.hpCode === "HP001" &&
      alpha.hpName === "Sample HP Alpha",
  );

  check(
    "the row maps to an HM by CODE, and carries the name for the preview",
    alpha.hmId === "hm-alpha" && alpha.hmName === "Sample HM Alpha",
  );

  check(
    "the stored total is the calculated one; the Excel column is kept beside it",
    alpha.totalKeyIn === 10 && alpha.excelTotalKeyIn === 10,
  );

  check(
    "an all-blank week row is Total Key-In 0 and INACTIVE",
    preview.rows[1]!.totalKeyIn === 0 && preview.rows[1]!.isActive === false,
  );

  check(
    "Total Net is independent of Total Key-In",
    preview.rows[1]!.totalNet === 4 && preview.rows[1]!.totalKeyIn === 0,
  );

  check(
    "the payload carries the calculated total, never the spreadsheet's",
    preview.payload[0]!.total_key_in === 10 &&
      preview.payload[0]!.w1 + preview.payload[0]!.w2 +
        preview.payload[0]!.w3 + preview.payload[0]!.w4 === 10,
  );
}

{
  const preview = previewOf([
    ["Coway HM2 - HP performance"],
    [],
    HEADER,
    ["HM10321", "Sample HP Alpha", "HP001", 1, 0, 0, 0, 1, 1],
  ]);

  check(
    "a title and a blank line above the table do not stop the import",
    preview.canCommit && preview.summary.rowsDetected === 1,
    JSON.stringify(preview.errors),
  );

  check(
    "and the row number quoted is the one Excel shows",
    preview.rows[0]!.rowNumber === 4,
    String(preview.rows[0]!.rowNumber),
  );
}

{
  const preview = previewOf([
    ["HM CODE", "HP NAME", "HP CODE", "W1 KEY-IN", "W2 KEY-IN"],
    ["HM10321", "Sample HP Alpha", "HP001", 1, 0],
  ]);

  check("missing columns stop the import", !preview.canCommit);
  check(
    "and the message names every one of them",
    preview.errors[0]!.message.includes("W3 KEY-IN") &&
      preview.errors[0]!.message.includes("W4 KEY-IN") &&
      preview.errors[0]!.message.includes("TOTAL KEY-IN") &&
      preview.errors[0]!.message.includes("TOTAL NET"),
    preview.errors[0]!.message,
  );
}

{
  const preview = previewOf([
    ["Something", "Else", "Entirely"],
    ["a", "b", "c"],
  ]);

  check(
    "a sheet with no heading row is refused, not read as data",
    !preview.canCommit &&
      preview.errors.some((issue) => issue.code === "no_header"),
  );
}

{
  const accumulated = [...HEADER];
  accumulated[8] = "ACCUMULATED NET";

  const preview = previewOf([
    accumulated,
    ["HM10321", "Sample HP Alpha", "HP001", 1, 0, 0, 0, 1, 7],
  ]);

  check(
    "the historical ACCUMULATED NET heading is read as TOTAL NET",
    preview.canCommit && preview.rows[0]!.totalNet === 7,
    JSON.stringify(preview.errors),
  );

  check(
    "and the PA is TOLD it was, rather than left to assume",
    preview.warnings.some((issue) => issue.code === "accumulated_net_heading"),
  );
}

{
  const preview = previewOf([
    HEADER,
    ["HM99999", "Sample HP Alpha", "HP001", 1, 0, 0, 0, 1, 1],
  ]);

  check(
    "an unknown HM Code stops the import",
    !preview.canCommit &&
      preview.errors.some((issue) => issue.code === "unknown_hm_code"),
  );

  check(
    "and the message names the row and the code",
    preview.errors[0]!.message.includes("Row 2") &&
      preview.errors[0]!.message.includes("HM99999"),
    preview.errors[0]!.message,
  );

  check(
    "the row is still shown, marked as unmatched, so the PA can see the mapping",
    preview.rows.length === 1 && preview.rows[0]!.hmId === null,
  );
}

{
  const preview = previewOf([
    HEADER,
    ["HM10321", "Sample HP Alpha", "HP001", 1, 0, 0, 0, 1, 1],
    ["HM10321", "Sample HP Alpha again", "hp001", 2, 0, 0, 0, 2, 2],
  ]);

  check(
    "a duplicate HP Code stops the import - the rows are never merged",
    !preview.canCommit &&
      preview.errors.some((issue) => issue.code === "duplicate_hp_code"),
  );

  check(
    "and BOTH offending rows are named",
    preview.errors[0]!.message.includes("2") &&
      preview.errors[0]!.message.includes("3"),
    preview.errors[0]!.message,
  );
}

{
  const preview = previewOf([
    HEADER,
    ["HM10321", "Sample HP Alpha", "HP001", 3, 4, 5, 2, 15, 1],
  ]);

  check(
    "a Total Key-In that disagrees with W1-W4 stops the import",
    !preview.canCommit &&
      preview.errors.some((issue) => issue.code === "total_key_in_mismatch"),
  );

  check(
    "and the message shows BOTH figures, so the PA can see which is wrong",
    preview.errors[0]!.message.includes("15") &&
      preview.errors[0]!.message.includes("14"),
    preview.errors[0]!.message,
  );
}

{
  const preview = previewOf([
    HEADER,
    ["HM10321", "Sample HP Alpha", "HP001", "three", 0, 0, 0, 0, 1],
    ["HM10321", "Sample HP Beta", "HP002", -1, 0, 0, 0, -1, 1],
    ["HM10321", "Sample HP Gamma", "HP003", 1, 0, 0, 0, 1, -5],
    ["HM10321", "Sample HP Delta", "HP004", 1.5, 0, 0, 0, 1.5, 1],
  ]);

  const codes = preview.errors.map((issue) => issue.code);

  check("text in a numeric cell is refused", codes.includes("not_a_number"));
  check("a negative Key-In is refused", codes.includes("negative"));
  check("a negative Total Net is refused", codes.includes("negative"));
  check("half a unit is refused", codes.includes("not_a_whole_number"));
  check("and none of it may be committed", !preview.canCommit);
}

{
  const preview = previewOf([
    HEADER,
    ["", "Sample HP Alpha", "HP001", 1, 0, 0, 0, 1, 1],
    ["HM10321", "", "HP002", 1, 0, 0, 0, 1, 1],
    ["HM10321", "Sample HP Gamma", "", 1, 0, 0, 0, 1, 1],
  ]);

  check(
    "HM Code, HP Name and HP Code are each required",
    preview.errors.filter((issue) => issue.code === "missing_value").length === 3,
  );
}

{
  const preview = previewOf([
    HEADER,
    ["HM10321", "Sample HP Alpha", "HP 001", 1, 0, 0, 0, 1, 1],
  ]);

  check(
    "a code the database would refuse is caught before the database sees it",
    !preview.canCommit &&
      preview.errors.some((issue) => issue.code === "invalid_hp_code"),
  );
}

{
  const preview = previewOf([
    HEADER,
    ["HM10321", "Sample HP Alpha", "HP001", 1, 0, 0, 0, 1, 1],
    [null, null, null, null, null, null, null, null, null],
  ]);

  check(
    "a trailing blank row is where the sheet ends, not a broken row",
    preview.canCommit && preview.summary.rowsDetected === 1,
    JSON.stringify(preview.errors),
  );
}

{
  const preview = previewOf([HEADER]);

  check(
    "a heading row with nothing under it is refused",
    !preview.canCommit && preview.errors.some((issue) => issue.code === "no_rows"),
  );
}

check(
  "a rejected preview hands on NO payload at all",
  previewOf([HEADER, ["HM99999", "A", "HP001", 1, 0, 0, 0, 1, 1]]).payload
    .length === 0,
);

// =============================================================================
section("[S8-E] the commit payload schema");
// =============================================================================

{
  const row = {
    row_no: 2,
    hm_code: "HM10321",
    hp_code: "HP001",
    hp_name: "Sample HP Alpha",
    w1: 1,
    w2: 0,
    w3: 0,
    w4: 0,
    total_key_in: 1,
    total_net: 1,
  };

  const base = { month_id: "6c3d0a3e-6f8f-4a4a-9f2c-9b1a2f7e5c11", file_name: "sept.xlsx" };

  check(
    "a validated payload is accepted",
    hpImportCommitSchema.safeParse({ ...base, rows: [row] }).success,
  );

  check(
    "an empty import is refused",
    !hpImportCommitSchema.safeParse({ ...base, rows: [] }).success,
  );

  check(
    "a code with a space in it is refused",
    !hpImportCommitSchema.safeParse({
      ...base,
      rows: [{ ...row, hp_code: "HP 001" }],
    }).success,
  );

  check(
    "a negative week is refused",
    !hpImportCommitSchema.safeParse({ ...base, rows: [{ ...row, w1: -1 }] })
      .success,
  );

  check(
    "the file name is required - an import must record where it came from",
    !hpImportCommitSchema.safeParse({ ...base, file_name: "  ", rows: [row] })
      .success,
  );

  check(
    "a result that is not the shape the function returns is `null`, never guessed",
    parseHpImportResult(null) === null &&
      parseHpImportResult({ rows_processed: 3 }) === null,
  );
}

// =============================================================================
section("[S8-F] Active HP through the engine");
// =============================================================================

function calculateMonth(roster: Roster, records: ReturnType<typeof buildMonthRecords>) {
  const weeks = records.weeks.map(toSalesWeekInput);

  return calculateGroupMonthlyPerformance({
    month: toMonthInput(records.month),
    weeks,
    hms: calculateHmMonthlyPerformances(
      buildHmMonthInputs({
        hms: rosterList(roster),
        weeks: records.weeks,
        monthly: records.monthly,
        weekly: records.weekly,
        hpActive: records.hpActive,
      }),
      weeks,
    ),
    groupShiPct: null,
  });
}

{
  const roster = createRoster(["Alpha", "Bravo", "Charlie"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: SEPTEMBER_WEEKS,
    hms: {
      Alpha: { monthly: { net: 40, activeHp: 31, hpCount: 34 }, weekly: [20] },
      // HP data imported, none of them active. A real zero.
      Bravo: { monthly: { net: 10, activeHp: 0, hpCount: 8 }, weekly: [5] },
      // No HP data at all. Blank, and it must not read as zero.
      Charlie: { monthly: { net: 5 }, weekly: [3] },
    },
  });

  const group = calculateMonth(roster, records);
  const byId = new Map(group.hms.map((hm) => [hm.hmId, hm] as const));

  check(
    "an HM's Active HP is the count from the HP rows",
    byId.get(hmId(roster, "Alpha"))!.activeHp === 31,
  );

  check(
    "an HM with HP rows and none active is 0",
    byId.get(hmId(roster, "Bravo"))!.activeHp === 0,
  );

  check(
    "an HM with no HP rows is BLANK, not 0",
    byId.get(hmId(roster, "Charlie"))!.activeHp === null,
  );

  check(
    "Group Active HP is the SUM of the HM counts, blanks contributing nothing",
    group.totalActiveHp === 31 && group.contributors.activeHp === 2,
    `${group.totalActiveHp} from ${group.contributors.activeHp}`,
  );

  check(
    "presence records whether HP data exists for the HM",
    byId.get(hmId(roster, "Alpha"))!.presence.hasHpData === true &&
      byId.get(hmId(roster, "Charlie"))!.presence.hasHpData === false,
  );
}

{
  // The Stage 8 case: the Excel has been imported, the HM KPIs have not been
  // keyed in yet. Active HP still has to be there.
  const roster = createRoster(["Alpha"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: SEPTEMBER_WEEKS,
    hms: { Alpha: { activeHp: 12, hpCount: 15 } },
  });

  const hm = calculateMonth(roster, records).hms[0]!;

  check(
    "Active HP survives an HM with no monthly row at all",
    hm.activeHp === 12 && hm.presence.hasMonthlyRecord === false,
  );

  check(
    "and Net is still blank, because nobody has keyed it in",
    hm.netUnits === null,
  );

  check(
    "the month counts as having data, so the dashboard shows it",
    hm.presence.hasAnyData === true,
  );
}

{
  // Nothing may read the deprecated column. Proved by contradicting it: the
  // fixture writes 0 into `active_hp` while the HP summary says 31.
  const roster = createRoster(["Alpha"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: SEPTEMBER_WEEKS,
    hms: { Alpha: { monthly: { net: 40, activeHp: 31 }, weekly: [20] } },
  });

  check(
    "the fixture's monthly row really does hold the deprecated 0",
    records.monthly[0] !== undefined &&
      (records.monthly[0] as unknown as { active_hp: number }).active_hp === 0,
  );

  check(
    "and the engine still reports 31 - the column is not read",
    calculateMonth(roster, records).hms[0]!.activeHp === 31,
  );
}

// =============================================================================
section("[S8-G] the dashboard, the HM screen and the links between them");
// =============================================================================

{
  const roster = createRoster([
    { name: "Alpha", hmCode: "HM10321" },
    { name: "Bravo", hmCode: "HM10322" },
  ]);

  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: SEPTEMBER_WEEKS,
    hms: {
      Alpha: { monthly: { net: 76, target: 100, activeHp: 31 }, weekly: [20, 18] },
      Bravo: { monthly: { net: 54, target: 80, activeHp: 24 }, weekly: [14, 15] },
    },
  });

  const performance = buildMonthlyPerformanceViewModel({
    selectedMonthId: september.month.id,
    hms: rosterList(roster),
    months: [september],
    groupShiPct: null,
  })!;

  const dashboard = buildDashboardViewModel({
    selectedMonth: september.month,
    performance,
    lastUpdatedAt: null,
  });

  const activeHpTile = dashboard.kpis.find((tile) => tile.key === "activeHp")!;

  check("Group Active HP on the dashboard is 31+24", activeHpTile.value === "55");

  check(
    "the Active HP tile links to the HP list, on this month, active only",
    activeHpTile.href ===
      hpListingPath({ month: dashboard.month.param, activeOnly: true }),
    activeHpTile.href ?? "no href",
  );

  check(
    "and it says where the figure comes from",
    activeHpTile.note === "HPs with Key-In this month",
    activeHpTile.note ?? "",
  );

  const alpha = dashboard.hms.find((hm) => hm.name === "Alpha")!;

  check("every HM card carries its HM Code", alpha.hmCode === "HM10321");

  check(
    "the card's Active HP links to that HM's HP list, on this month",
    alpha.activeHpHref ===
      hpListingPath({
        month: dashboard.month.param,
        hmId: alpha.hmId,
        activeOnly: true,
      }),
    alpha.activeHpHref ?? "no href",
  );

  check(
    "the link carries the month, the HM and the active filter together",
    alpha.activeHpHref!.includes("month=2026-09") &&
      alpha.activeHpHref!.includes(`hm=${alpha.hmId}`) &&
      alpha.activeHpHref!.includes("active=1"),
    alpha.activeHpHref ?? "",
  );

  // ---- the HM's own screen -------------------------------------------------
  const hmModel = buildHmPerformanceViewModel(
    {
      selectedMonthId: september.month.id,
      hms: rosterList(roster),
      months: [september],
      groupShiPct: null,
    },
    alpha.hmId,
  )!;

  const privateDetail = buildHmDetailViewModel({
    selectedMonth: september.month,
    model: hmModel,
    lastUpdatedAt: null,
    hpListingHref: hpListingPath({
      month: dashboard.month.param,
      hmId: alpha.hmId,
      activeOnly: true,
    }),
  });

  check("the HM screen shows the HM Code", privateDetail.hm.hmCode === "HM10321");

  const detailActiveHp = privateDetail.secondary.find(
    (metric) => metric.key === "activeHp",
  )!;

  check(
    "the HM's Active HP is the same figure the card showed",
    detailActiveHp.value === alpha.activeHpLabel && detailActiveHp.value === "31",
  );

  check(
    "and it links to the same filtered list",
    detailActiveHp.href === alpha.activeHpHref,
    detailActiveHp.href ?? "no href",
  );

  // ---- the same model, for a public viewer ---------------------------------
  //
  // A share-token reader now HAS an HP list - their own, under the token - so
  // the public model carries a link too. What must never happen is that link
  // being the private one, and that is a property of who builds it: the caller
  // holding a token builds a `/share/...` path, and nothing that lacks one can
  // hand this presenter a `/hp` path for a public audience.
  const publicHpHref = shareHmHpPath(PUBLIC_TOKEN, alpha.hmId);

  const publicDetail = buildHmDetailViewModel({
    selectedMonth: september.month,
    model: hmModel,
    lastUpdatedAt: null,
    audience: "public",
    hpListingHref: publicHpHref,
  });

  check(
    "a public viewer gets no HM Code - it is absent from the MODEL, not just unrendered",
    publicDetail.hm.hmCode === null,
  );

  const publicActiveHp = publicDetail.secondary.find(
    (metric) => metric.key === "activeHp",
  )!;

  check(
    "their Active HP links to the HP list UNDER THE TOKEN",
    publicActiveHp.href === publicHpHref &&
      publicActiveHp.href!.startsWith(`${ROUTES.share}/`),
    publicActiveHp.href ?? "no href",
  );

  check(
    "and never into the private app",
    !publicActiveHp.href!.startsWith(ROUTES.hpListing) &&
      !publicActiveHp.href!.includes("?"),
    publicActiveHp.href ?? "",
  );

  check(
    "while the FIGURE is still the same on both",
    publicActiveHp.value === detailActiveHp.value,
  );

  check(
    "a public model with no token to build a path from is simply unlinked",
    buildHmDetailViewModel({
      selectedMonth: september.month,
      model: hmModel,
      lastUpdatedAt: null,
      audience: "public",
    }).secondary.find((metric) => metric.key === "activeHp")!.href == null,
  );
}

{
  const roster = createRoster([{ name: "Alpha", hmCode: "HM10321" }]);
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: SEPTEMBER_WEEKS,
    hms: { Alpha: { monthly: { net: 40 }, weekly: [20] } },
  });

  const dashboard = buildDashboardViewModel({
    selectedMonth: september.month,
    performance: buildMonthlyPerformanceViewModel({
      selectedMonthId: september.month.id,
      hms: rosterList(roster),
      months: [september],
      groupShiPct: null,
    })!,
    lastUpdatedAt: null,
  });

  const tile = dashboard.kpis.find((entry) => entry.key === "activeHp")!;

  check(
    "with no HP data the KPI is blank, and says so rather than reporting 0",
    tile.value === "—" && tile.note === "No HP data imported",
    `${tile.value} / ${tile.note}`,
  );

  check("and it is not a link to an empty list", tile.href === null);

  check(
    "the HM card's Active HP is blank and unlinked too",
    dashboard.hms[0]!.activeHpLabel === "—" &&
      dashboard.hms[0]!.activeHpHref === null,
  );
}

// =============================================================================
section("[S8-H] the HP listing presenter");
// =============================================================================

{
  const month: Month = {
    id: "month-1",
    year: 2026,
    month: 9,
    label: "September 2026",
    quarter: 3,
    created_at: "2026-09-01T00:00:00Z",
  };

  const hms: HM[] = [
    {
      id: "hm-alpha",
      name: "Sample HM Alpha",
      hm_code: "HM10321",
      office: "Sample Office",
      photo_url: null,
      status: "active",
      display_order: 1,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
  ];

  const listing: HpListing = {
    rows: [
      {
        id: "row-1",
        month_id: month.id,
        hp_id: "hp-1",
        hm_id: "hm-alpha",
        hp_code: "HP001",
        hp_name: "Sample HP Alpha",
        hm_name: "Sample HM Alpha",
        hm_code: "HM10321",
        w1_key_in: 3,
        w2_key_in: 0,
        w3_key_in: 5,
        w4_key_in: 2,
        total_key_in: 10,
        total_net: 8,
        is_active: true,
        updated_at: "2026-09-04T00:00:00Z",
      },
    ],
    total: 148,
    page: 2,
    pageCount: 3,
    pageSize: 50,
  };

  const model = buildHpListingViewModel({
    selectedMonth: month,
    listing,
    activeTotal: 96,
    hms,
    filters: { hmId: null, activeOnly: true, search: "" },
  });

  const row = model.rows[0]!;

  check(
    "a row carries all ten required fields",
    row.hpName === "Sample HP Alpha" &&
      row.hpCode === "HP001" &&
      row.hmName === "Sample HM Alpha" &&
      row.hmCode === "HM10321" &&
      row.weekLabels.join(",") === "3,0,5,2" &&
      row.totalKeyInLabel === "10" &&
      row.totalNetLabel === "8",
    JSON.stringify(row),
  );

  check("and its status comes off the database's own flag", row.isActive && row.statusLabel === "Active");

  check(
    "the header's Active HP is the month's count, not this page's",
    model.activeLabel === "96",
  );

  check(
    "the range names where in the whole list this page is",
    model.pagination.rangeLabel === "Showing 51–100 of 148",
    model.pagination.rangeLabel,
  );

  check(
    "paging keeps every filter",
    model.pagination.nextHref!.includes("month=2026-09") &&
      model.pagination.nextHref!.includes("active=1") &&
      model.pagination.nextHref!.includes("page=3"),
    model.pagination.nextHref ?? "",
  );

  check(
    "the HM filter offers name AND code, because a PA thinks in codes",
    model.filters.hms[0]!.label === "Sample HM Alpha · HM10321",
  );

  const empty = buildHpListingViewModel({
    selectedMonth: month,
    listing: { rows: [], total: 0, page: 1, pageCount: 1, pageSize: 50 },
    activeTotal: 0,
    hms,
    filters: { hmId: null, activeOnly: false, search: "" },
  });

  check(
    "an unfiltered empty month says nothing has been imported",
    empty.emptyMessage === "No HP data has been imported for this month yet." &&
      empty.clearFiltersHref === null,
  );

  const filtered = buildHpListingViewModel({
    selectedMonth: month,
    listing: { rows: [], total: 0, page: 1, pageCount: 1, pageSize: 50 },
    activeTotal: 0,
    hms,
    filters: { hmId: "hm-alpha", activeOnly: true, search: "zzz" },
  });

  check(
    "a filtered empty result says so instead, and offers a way out",
    filtered.emptyMessage!.includes("filters") &&
      filtered.clearFiltersHref === hpListingPath({ month: "2026-09" }),
  );
}

// =============================================================================
section("[S8-I] routes stay private");
// =============================================================================

check(
  "/hp and /hp-import are NOT public routes",
  !isPublicRoute(ROUTES.hpListing) &&
    !isPublicRoute(ROUTES.hpImport) &&
    !PUBLIC_ROUTES.includes(ROUTES.hpListing) &&
    !PUBLIC_ROUTES.includes(ROUTES.hpImport),
);

check(
  "there is no anonymous HP route at all - /share is still the only public one",
  PUBLIC_ROUTES.filter((route) => route.startsWith("/hp")).length === 0,
);

check(
  "both a PA and a manager can reach the HP section",
  navItemsForRole("pa").some((item) => item.href === ROUTES.hpListing) &&
    navItemsForRole("manager").some((item) => item.href === ROUTES.hpListing),
);

check(
  "the import path carries the month",
  hpImportPath("2026-09") === "/hp-import?month=2026-09" &&
    hpImportPath(null) === "/hp-import",
);

check(
  "the listing path is built once, and omits what was not asked for",
  hpListingPath({}) === "/hp" &&
    hpListingPath({ month: "2026-09" }) === "/hp?month=2026-09" &&
    hpListingPath({ month: "2026-09", activeOnly: true }) ===
      "/hp?month=2026-09&active=1",
);

// =============================================================================
section("[S8-J] source-level facts no runtime test can prove");
// =============================================================================

{
  const dataModule = read("lib/data/hp.ts");

  check(
    "the HP data module is server-only",
    dataModule.includes('import "server-only"'),
  );

  check(
    "and never reaches for the service-role client",
    !dataModule.includes("admin") &&
      dataModule.includes("createSupabaseServerClient"),
  );

  check(
    "the listing reads the joined VIEW, so no row triggers a lookup of its own",
    dataModule.includes('.from("hp_monthly_report")') &&
      !dataModule.includes('.from("hps")\n      .select("hp_name'),
  );

  check(
    "it pages rather than fetching a whole month of rows",
    dataModule.includes(".range(") && dataModule.includes("HP_PAGE_SIZE"),
  );

  check(
    "and the HP code list is paged too - a plain select is capped by max-rows",
    dataModule.includes("readAllHpCodes") &&
      dataModule.includes("HP_CODE_PAGE"),
  );

  const importer = read("lib/import/hp-import.ts");

  check(
    "the importer is pure - no Supabase anywhere in it",
    !importer.includes("supabase") && !importer.includes("server-only"),
  );

  // A Client Component reads the size limit to put it in a sentence. Reading it
  // off the parser would drag `node:zlib` into the browser bundle, so the
  // limits both sides need live in a module that imports nothing at all.
  const limits = read("lib/import/limits.ts");

  check(
    "the shared limits module has no imports of its own",
    !/^import /m.test(limits),
  );

  const workspace = read("components/hp/hp-import-workspace.tsx");

  check(
    "and the upload form never imports the parser",
    !workspace.includes('from "@/lib/import/xlsx"'),
  );

  const actions = read("lib/actions/hp-import.ts");

  const exportedLines = actions.match(/^export .*/gm) ?? [];

  check(
    'every export of the "use server" module is an async function',
    exportedLines.length === 2 &&
      exportedLines.every((line) => line.startsWith("export async function")),
    exportedLines.join(" | "),
  );

  const engine = read("lib/calculations/hp.ts");

  check(
    "and the HP calculations import nothing but the engine's own types",
    !engine.includes("supabase") && !engine.includes("react"),
  );

  const inputs = read("lib/calculations/inputs.ts");

  check(
    "the engine no longer reads the deprecated active_hp column",
    !inputs.includes("active_hp"),
  );

  const gridModel = read("lib/data-entry/grid-model.ts");
  const dataEntryValidation = read("lib/validation/data-entry.ts");

  check(
    "and Data Entry no longer offers Active HP as an input",
    !gridModel.includes('"active_hp"') &&
      !dataEntryValidation.includes("active_hp"),
  );

  const performanceAction = read("lib/actions/performance.ts");

  check(
    "the grid save omits active_hp, so pre-Stage-8 figures are not overwritten",
    !performanceAction.includes("active_hp: row.active_hp"),
  );

  const rpc = readFileSync(
    path.join(SUPABASE, "migrations", "20260907110000_hp_import_rpc.sql"),
    "utf8",
  );

  check(
    "import_hp_month is NOT security definer - it runs as the caller under RLS",
    !/create or replace function public\.import_hp_month[\s\S]*?as \$fn\$/.exec(
      rpc,
    )?.[0]?.includes("security definer"),
  );

  check(
    "it validates the whole payload before the first INSERT",
    rpc.indexOf("hp_import_unknown_hm_code") <
      rpc.indexOf("insert into public.hps"),
  );
}

// =============================================================================
section("[S8-K] the import, against a real Postgres");
// =============================================================================

{
  const db = await PGlite.create();

  await db.exec(readFileSync(path.join(SUPABASE, "tests", "bootstrap.sql"), "utf8"));

  for (const file of readdirSync(path.join(SUPABASE, "migrations")).sort()) {
    await db.exec(readFileSync(path.join(SUPABASE, "migrations", file), "utf8"));
  }

  // The trailing comma is not a typo: in a .mts file a lone type parameter on
  // an arrow function is ambiguous with JSX, and this is how it is disambiguated.
  const first = async <T,>(sql: string): Promise<T> =>
    (await db.query(sql)).rows[0] as T;

  const PA = "11111111-1111-1111-1111-111111111111";
  const MANAGER = "22222222-2222-2222-2222-222222222222";

  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${PA}', 'pa@example.test', '{"full_name":"Sample PA","role":"pa"}'),
      ('${MANAGER}', 'manager@example.test', '{"full_name":"Sample Manager","role":"manager"}');
  `);

  const alpha = await first<{ id: string }>(
    `insert into public.hms (name, hm_code, office, display_order)
       values ('Sample HM Alpha', 'HM10321', 'Sample Office', 1) returning id`,
  );
  const bravo = await first<{ id: string }>(
    `insert into public.hms (name, hm_code, office, display_order)
       values ('Sample HM Bravo', 'HM10322', 'Sample Office', 2) returning id`,
  );

  const september = await first<{ id: string }>(
    `insert into public.months (year, month, label, quarter)
       values (2026, 9, '', 3) returning id`,
  );
  const august = await first<{ id: string }>(
    `insert into public.months (year, month, label, quarter)
       values (2026, 8, '', 3) returning id`,
  );

  const asUser = async (id: string) => {
    await db.exec(`set role authenticated`);
    await db.query(
      `select set_config('request.jwt.claim.sub', '${id}', false)`,
    );
  };

  const asSuperuser = async () => {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  };

  const importAs = async (
    who: string,
    monthId: string,
    fileName: string,
    rows: readonly Record<string, unknown>[],
  ) => {
    await asUser(who);

    try {
      const result = await db.query(
        `select public.import_hp_month('${monthId}'::uuid, $1, $2::jsonb) as body`,
        [fileName, JSON.stringify(rows)],
      );

      return {
        ok: true as const,
        body: (result.rows[0] as { body: unknown }).body,
      };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    } finally {
      await asSuperuser();
    }
  };

  const row = (
    hmCode: string,
    hpCode: string,
    hpName: string,
    weeks: [number, number, number, number],
    net: number,
    rowNo = 2,
  ) => ({
    row_no: rowNo,
    hm_code: hmCode,
    hp_code: hpCode,
    hp_name: hpName,
    w1: weeks[0],
    w2: weeks[1],
    w3: weeks[2],
    w4: weeks[3],
    total_key_in: weeks[0] + weeks[1] + weeks[2] + weeks[3],
    total_net: net,
  });

  // ---- a PA imports --------------------------------------------------------
  const firstImport = await importAs(PA, september.id, "september.xlsx", [
    row("HM10321", "hp001", "Sample HP Alpha", [3, 0, 5, 2], 8, 2),
    row("HM10321", "HP002", "Sample HP Beta", [0, 0, 0, 0], 0, 3),
    row("HM10322", "HP003", "Sample HP Gamma", [1, 0, 0, 0], 1, 4),
  ]);

  check("a PA may import HP data", firstImport.ok, firstImport.ok ? "" : firstImport.message);

  const parsed = firstImport.ok ? parseHpImportResult(firstImport.body) : null;

  check(
    "the function reports what it did",
    parsed !== null &&
      parsed.rowsProcessed === 3 &&
      parsed.newHp === 3 &&
      parsed.updatedHp === 0 &&
      parsed.activeHp === 2 &&
      parsed.inactiveHp === 1,
    JSON.stringify(parsed),
  );

  const stored = await first<{ hp_code: string; total_key_in: number; hm: string }>(
    `select h.hp_code, p.total_key_in, m.hm_code as hm
       from public.hp_monthly_performance p
       join public.hps h on h.id = p.hp_id
       join public.hms m on m.id = p.hm_id
      where h.hp_code = 'HP001'`,
  );

  check(
    "the HP Code is stored uppercased, and Total Key-In is the calculated sum",
    stored.hp_code === "HP001" && stored.total_key_in === 10,
    JSON.stringify(stored),
  );

  check("the row is owned by the HM its CODE named", stored.hm === "HM10321");

  const summary = await db.query<{ hm_id: string; hp_count: number; active_hp: number }>(
    `select hm_id, hp_count, active_hp from public.hm_monthly_hp_summary
      where month_id = '${september.id}' order by hm_id`,
  );

  const counts = new Map(
    summary.rows.map((entry) => [entry.hm_id, entry] as const),
  );

  check(
    "Active HP is counted per HM: Alpha 1 of 2, Bravo 1 of 1",
    counts.get(alpha.id)!.hp_count === 2 &&
      counts.get(alpha.id)!.active_hp === 1 &&
      counts.get(bravo.id)!.active_hp === 1,
    JSON.stringify(summary.rows),
  );

  // ---- re-importing the same month ----------------------------------------
  const secondImport = await importAs(PA, september.id, "september-v2.xlsx", [
    // Renamed AND moved to another HM. Both follow the file.
    row("HM10322", "HP001", "Sample HP Alpha Renamed", [4, 4, 4, 4], 12, 2),
    // A new HP appearing mid-month.
    row("HM10321", "HP004", "Sample HP Delta", [2, 0, 0, 0], 2, 3),
  ]);

  check("a second import of the same month is accepted", secondImport.ok);

  const secondResult = secondImport.ok
    ? parseHpImportResult(secondImport.body)
    : null;

  check(
    "and it separates the new HP from the existing one",
    secondResult !== null &&
      secondResult.newHp === 1 &&
      secondResult.updatedHp === 1,
    JSON.stringify(secondResult),
  );

  const renamed = await first<{ hp_name: string; hm: string; total_key_in: number }>(
    `select h.hp_name, m.hm_code as hm, p.total_key_in
       from public.hp_monthly_performance p
       join public.hps h on h.id = p.hp_id
       join public.hms m on m.id = p.hm_id
      where h.hp_code = 'HP001'`,
  );

  check(
    "an existing HP's name and HM follow the file",
    renamed.hp_name === "Sample HP Alpha Renamed" &&
      renamed.hm === "HM10322" &&
      renamed.total_key_in === 16,
    JSON.stringify(renamed),
  );

  const survivors = await db.query<{ hp_code: string }>(
    `select h.hp_code from public.hp_monthly_performance p
       join public.hps h on h.id = p.hp_id
      where p.month_id = '${september.id}' order by h.hp_code`,
  );

  check(
    "an HP absent from the second file is NOT deleted - history is preserved",
    survivors.rows.map((entry) => entry.hp_code).join(",") ===
      "HP001,HP002,HP003,HP004",
    survivors.rows.map((entry) => entry.hp_code).join(","),
  );

  // ---- month isolation -----------------------------------------------------
  const augustImport = await importAs(PA, august.id, "august.xlsx", [
    row("HM10321", "HP001", "Sample HP Alpha", [1, 1, 1, 1], 3, 2),
  ]);

  check("August imports independently", augustImport.ok);

  const septemberStill = await first<{ total_key_in: number }>(
    `select p.total_key_in from public.hp_monthly_performance p
       join public.hps h on h.id = p.hp_id
      where h.hp_code = 'HP001' and p.month_id = '${september.id}'`,
  );

  check(
    "and September's figure for the same HP is untouched",
    septemberStill.total_key_in === 16,
    String(septemberStill.total_key_in),
  );

  const augustCount = await first<{ c: string }>(
    `select count(*) as c from public.hp_monthly_performance
      where month_id = '${august.id}'`,
  );

  check("August holds only its own row", Number(augustCount.c) === 1);

  // ---- nothing partial -----------------------------------------------------
  const beforeFailure = await first<{ c: string }>(
    `select count(*) as c from public.hp_monthly_performance`,
  );

  const rejected = await importAs(PA, september.id, "broken.xlsx", [
    row("HM10321", "HP010", "Sample HP Echo", [1, 0, 0, 0], 1, 2),
    row("HM99999", "HP011", "Sample HP Foxtrot", [1, 0, 0, 0], 1, 3),
  ]);

  check(
    "an unknown HM Code refuses the whole import",
    !rejected.ok && rejected.message.includes("hp_import_unknown_hm_code"),
    rejected.ok ? "accepted" : rejected.message,
  );

  const afterFailure = await first<{ c: string }>(
    `select count(*) as c from public.hp_monthly_performance`,
  );

  check(
    "and writes NOTHING - not even the valid row above it",
    beforeFailure.c === afterFailure.c,
    `${beforeFailure.c} -> ${afterFailure.c}`,
  );

  const orphan = await first<{ c: string }>(
    `select count(*) as c from public.hps where hp_code = 'HP010'`,
  );

  check("no HP was created by the failed import either", Number(orphan.c) === 0);

  for (const [label, rows, fragment] of [
    [
      "a duplicate HP Code",
      [
        row("HM10321", "HP020", "A", [1, 0, 0, 0], 1, 2),
        row("HM10321", "HP020", "B", [1, 0, 0, 0], 1, 3),
      ],
      "hp_import_duplicate_hp_code",
    ],
    [
      "a Total Key-In that disagrees with its weeks",
      [{ ...row("HM10321", "HP021", "A", [1, 0, 0, 0], 1, 2), total_key_in: 9 }],
      "hp_import_total_mismatch",
    ],
    [
      "a negative Key-In",
      [{ ...row("HM10321", "HP022", "A", [0, 0, 0, 0], 0, 2), w1: -1, total_key_in: -1 }],
      "hp_import_negative_value",
    ],
    [
      "a blank HP Name",
      [{ ...row("HM10321", "HP023", "", [1, 0, 0, 0], 1, 2) }],
      "hp_import_missing_field",
    ],
    [
      "an empty payload",
      [],
      "hp_import_no_rows",
    ],
  ] as const) {
    const result = await importAs(PA, september.id, "bad.xlsx", rows);

    check(
      `${label} is refused at the database, not only in the preview`,
      !result.ok && result.message.includes(fragment),
      result.ok ? "accepted" : result.message,
    );
  }

  // ---- the audit trail -----------------------------------------------------
  const runs = await db.query<{
    file_name: string;
    rows_processed: number;
    imported_by: string;
    status: string;
  }>(
    `select file_name, rows_processed, imported_by, status
       from public.hp_import_runs where month_id = '${september.id}'
      order by created_at`,
  );

  check(
    "only the SUCCESSFUL imports were recorded",
    runs.rows.length === 2 &&
      runs.rows.map((entry) => entry.file_name).join(",") ===
        "september.xlsx,september-v2.xlsx",
    runs.rows.map((entry) => entry.file_name).join(","),
  );

  check(
    "and each one records who ran it, stamped from the JWT",
    runs.rows.every((entry) => entry.imported_by === PA),
  );

  // ---- the deprecated column -----------------------------------------------
  await db.exec(
    `insert into public.hm_monthly_performance
       (hm_id, month_id, net_units, target_net_units, recruitment, active_hp,
        shi_percentage, extrade_units, non_extrade_units)
     values ('${alpha.id}', '${september.id}', 40, 50, 2, 999, 80, 10, 30)`,
  );

  const derived = await first<{ active_hp: number }>(
    `select active_hp from public.hm_monthly_hp_summary
      where month_id = '${september.id}' and hm_id = '${alpha.id}'`,
  );

  check(
    "the summary ignores the deprecated active_hp column entirely",
    derived.active_hp !== 999,
    String(derived.active_hp),
  );

  // ---- the HP list behind a share token -------------------------------------
  //
  // The third public function, across the same seam and against the same real
  // Postgres. What is being proved is what a fixture cannot: that the jsonb
  // `resolve_share_hm_hp` builds feeds the page model, that the figures on it
  // are the ones the HM view they came from showed, and that the projection
  // carries nothing a token holder should not have.
  {
    const shareToken = "shareTokenForTheHpListTest_0123456789abcd";

    await db.exec(
      `insert into public.share_links (token, month_id)
         values ('${shareToken}', '${september.id}')`,
    );

    const resolveHp = async (tokenValue: string, id: string) => {
      await db.exec(`set role anon`);
      const body = (
        (await db.query(
          `select public.resolve_share_hm_hp('${tokenValue}', '${id}') as body`,
        )) as { rows: { body: unknown }[] }
      ).rows[0]!.body;
      await asSuperuser();

      return body;
    };

    const raw = await resolveHp(shareToken, alpha.id);

    check("anon resolves an HM's HP list under a live token", raw !== null);

    const payload = parseShareHpPayload(raw);

    check("the HP payload parses", payload !== null);

    // What the database itself says, so the assertions below compare two routes
    // to one figure rather than a figure to a number written in this file.
    const truth = await first<{ hp_count: number; active_hp: number }>(
      `select hp_count, active_hp from public.hm_monthly_hp_summary
        where month_id = '${september.id}' and hm_id = '${alpha.id}'`,
    );

    if (payload) {
      check(
        "its counts are the month's, and they are the summary view's own",
        payload.hpCount === truth.hp_count &&
          payload.activeHp === truth.active_hp,
        `${payload.activeHp}/${payload.hpCount} vs ${truth.active_hp}/${truth.hp_count}`,
      );

      check(
        "every row it carries belongs to the month",
        payload.hp.length === truth.hp_count,
        `${payload.hp.length} rows for ${truth.hp_count}`,
      );

      check(
        "active HPs come first, decided in SQL and not re-sorted here",
        payload.hp.every(
          (row, index, all) =>
            index === 0 || !row.is_active || all[index - 1]!.is_active,
        ),
        payload.hp.map((row) => (row.is_active ? "A" : "-")).join(""),
      );

      check(
        "a row's is_active agrees with the engine's threshold",
        payload.hp.every((row) => row.is_active === isHpActive(row.total_key_in)),
      );

      const serialised = JSON.stringify(payload.hp);

      check(
        "and a row carries no id, no hm_id and no audit column",
        !serialised.includes("created_by") &&
          !serialised.includes("updated_by") &&
          !serialised.includes("created_at") &&
          !serialised.includes("hp_id") &&
          !serialised.includes("hm_id") &&
          !serialised.includes(alpha.id),
        serialised.slice(0, 160),
      );

      check(
        "nor the HM Code - an internal mapping key the reader does not need",
        !JSON.stringify(payload.hm).includes("hm_code"),
        JSON.stringify(payload.hm),
      );

      // ---- the page model -------------------------------------------------
      const backHref = shareHmPath(shareToken, alpha.id);
      const list = buildShareHpList(payload, { backHref });

      check(
        "the page states the count as a sentence, from the month's own figures",
        list.headline ===
          `${truth.active_hp} of ${truth.hp_count} HP active this month`,
        list.headline,
      );

      check(
        "it renders a row per HP, with every field the table needs",
        list.rows.length === payload.hp.length &&
          list.rows.every(
            (row) =>
              row.hpName !== "" &&
              row.hpCode !== "" &&
              row.weekLabels.length === 4 &&
              row.totalKeyInLabel !== "" &&
              row.totalNetLabel !== "",
          ),
      );

      check(
        "the badge on a row is the engine's answer, not the payload's",
        list.rows.every(
          (row, index) => row.isActive === payload.hp[index]!.is_active,
        ),
      );

      check(
        "back goes to the HM view it was opened from, inside the token",
        list.backHref === backHref &&
          list.backHref.startsWith(`${ROUTES.share}/`),
      );

      check(
        "and the model carries no route into the private app",
        !JSON.stringify(list).includes(`${ROUTES.hpListing}?`),
      );

      // ---- the number the reader clicked, and the list they landed on -------
      await db.exec(`set role anon`);
      const hmBody = (
        (await db.query(
          `select public.resolve_share_hm_report('${shareToken}', '${alpha.id}') as body`,
        )) as { rows: { body: unknown }[] }
      ).rows[0]!.body;
      await asSuperuser();

      const hmPayload = parseShareHmPayload(hmBody);

      check("the HM view resolves under the same token", hmPayload !== null);

      if (hmPayload) {
        const hmDetail = buildShareHmDetail(hmPayload, {
          backHref: sharePath(shareToken),
          hpListingHref: shareHmHpPath(shareToken, alpha.id),
        })!;

        const activeHpMetric = hmDetail.secondary.find(
          (metric) => metric.key === "activeHp",
        )!;

        check(
          "the Active HP the HM taps and the list they land on are one figure",
          activeHpMetric.value === list.activeLabel,
          `${activeHpMetric.value} vs ${list.activeLabel}`,
        );

        check(
          "and the figure links to exactly this list",
          activeHpMetric.href === shareHmHpPath(shareToken, alpha.id),
          activeHpMetric.href ?? "no href",
        );
      }
    }

    // ---- the boundary, through the real function ----------------------------
    check(
      "a month id is not an HM id",
      (await resolveHp(shareToken, september.id)) === null,
    );

    check(
      "an id that matches nobody resolves to nothing",
      (await resolveHp(shareToken, "3f2504e0-4f89-11d3-9a0c-0305e82c3301")) ===
        null,
    );

    check(
      "a token that was never issued opens no HP list",
      (await resolveHp("notATokenThatWasEverIssued_0123456789abc", alpha.id)) ===
        null,
    );

    await db.exec(
      `update public.share_links set revoked_at = now(), is_active = false
        where token = '${shareToken}'`,
    );

    check(
      "and revoking the link closes the HP list in the same instant",
      (await resolveHp(shareToken, alpha.id)) === null,
    );

    // Executable by anon, and it changes nothing about the tables underneath.
    await db.exec(`set role anon`);

    let stillBlocked = false;

    try {
      await db.query(`select * from public.hps`);
    } catch {
      stillBlocked = true;
    }

    await asSuperuser();

    check(
      "anon may run the function and still cannot read an HP table directly",
      stillBlocked,
    );
  }

  // ---- constraints ---------------------------------------------------------
  {
    const hp = await first<{ id: string }>(
      `select id from public.hps where hp_code = 'HP002'`,
    );

    let refused = false;

    try {
      await db.exec(
        `update public.hp_monthly_performance
            set total_key_in = 99
          where hp_id = '${hp.id}' and month_id = '${september.id}'`,
      );
    } catch (error) {
      refused = (error as Error).message.includes(
        "hp_monthly_performance_total_derived",
      );
    }

    check(
      "the database refuses a Total Key-In that is not the sum of its own weeks",
      refused,
    );
  }

  {
    let refused = false;

    try {
      await db.exec(
        `insert into public.hps (hp_code, hp_name, hm_id)
           values ('HP001', 'Sample HP Duplicate', '${alpha.id}')`,
      );
    } catch (error) {
      refused = (error as Error).message.includes("hps_hp_code_key");
    }

    check("HP Code is unique", refused);
  }

  {
    let refused = false;

    try {
      await db.exec(
        `insert into public.hms (name, hm_code, office) values ('X', 'HM10321', 'Y')`,
      );
    } catch (error) {
      refused = (error as Error).message.includes("hms_hm_code_key");
    }

    check("HM Code is unique", refused);
  }

  {
    await db.exec(
      `insert into public.hms (name, hm_code, office) values ('Lower', ' hm10999 ', 'Y')`,
    );

    const normalized = await first<{ hm_code: string }>(
      `select hm_code from public.hms where name = 'Lower'`,
    );

    check(
      "an HM Code is uppercased and trimmed by the database, so matching is deterministic",
      normalized.hm_code === "HM10999",
      normalized.hm_code,
    );
  }

  // ---- the boundary --------------------------------------------------------
  {
    await db.exec(`set role anon`);

    const blocked: string[] = [];

    for (const relation of [
      "public.hps",
      "public.hp_monthly_performance",
      "public.hp_import_runs",
      "public.hm_monthly_hp_summary",
      "public.hp_monthly_report",
    ]) {
      try {
        await db.query(`select * from ${relation}`);
      } catch {
        blocked.push(relation);
      }
    }

    let importBlocked = false;

    try {
      await db.query(
        `select public.import_hp_month('${september.id}'::uuid, 'x.xlsx', '[]'::jsonb)`,
      );
    } catch {
      importBlocked = true;
    }

    await asSuperuser();

    check(
      "anon cannot read a single HP relation - privileges are revoked",
      blocked.length === 5,
      `reachable: ${5 - blocked.length}`,
    );

    check("and cannot execute the import function", importBlocked);
  }

  {
    // A PA holds a real JWT and can reach PostgREST directly, so "the UI does
    // not offer it" is not the rule - the policy is.
    await asUser(PA);

    const deleted = await db.query(
      `delete from public.hps where hp_code = 'HP002' returning id`,
    );

    await asSuperuser();

    check(
      "a PA cannot delete an HP - a failing USING clause matches no rows",
      deleted.rows.length === 0,
    );

    const survived = await first<{ c: string }>(
      `select count(*) as c from public.hps where hp_code = 'HP002'`,
    );

    check("and the record is still there", Number(survived.c) === 1);
  }

  {
    await db.exec(
      `insert into public.profiles (id, full_name, role) values ('${MANAGER}', 'Sample Manager', 'manager')
         on conflict (id) do update set role = 'manager'`,
    );

    await asUser(MANAGER);

    const deleted = await db.query(
      `delete from public.hps where hp_code = 'HP002' returning id`,
    );

    await asSuperuser();

    check("a manager can delete an HP", deleted.rows.length === 1);
  }

  {
    // A deactivated PA loses everything immediately - the same rule the rest of
    // the schema follows.
    await db.exec(`update public.profiles set is_active = false where id = '${PA}'`);

    const result = await importAs(PA, september.id, "after.xlsx", [
      row("HM10321", "HP030", "Sample HP Hotel", [1, 0, 0, 0], 1, 2),
    ]);

    await db.exec(`update public.profiles set is_active = true where id = '${PA}'`);

    check(
      "a deactivated PA cannot import",
      !result.ok && result.message.includes("hp_import_not_permitted"),
      result.ok ? "accepted" : result.message,
    );
  }

  await db.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
