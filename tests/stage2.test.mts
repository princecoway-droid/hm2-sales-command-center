/**
 * Stage 2 tests: calculations, the grid model, the calendar and the data-entry
 * schemas.
 *
 *   npm run test:stage2
 *
 * Same shape as the Stage 1 suite - plain Node, no test framework, one file.
 * Everything here is pure logic; the database side of the same rules is proved
 * in supabase/tests/schema.test.mjs, and Stage 1's tests/validation.test.mts is
 * untouched.
 */

import { randomUUID } from "node:crypto";

import {
  countBlankWeeks,
  extradePercentage,
  extradeRemainder,
  formatEntry,
  formatPercentage,
  hasAnyKeyIn,
  hasRecordedData,
  isSaveableSplit,
  nonExtradePercentage,
  percentageOf,
  recruitmentStatus,
  sumKeyIn,
  summariseCompleteness,
  targetAchievement,
  weeklyKeyInStatus,
  type CompletenessRow,
} from "@/lib/calculations/performance";
import {
  addDays,
  findCurrentMonth,
  findMonthNeighbours,
  formatWeekRange,
  monthLabel,
  nextAvailableWeekNumber,
  resolveSelectedMonth,
  sortMonthsAscending,
  suggestWeekRange,
} from "@/lib/calendar";
import {
  buildDraft,
  changedWeeklyCells,
  dirtyRowIds,
  entryToText,
  findClearedSavedWeeks,
  isGroupShiDirty,
  isRowDirty,
  monthlyValues,
  rowValues,
  toCompletenessRow,
  toEntry,
  validateRow,
  weeklyEntries,
  type RowDraft,
} from "@/lib/data-entry/grid-model";
import {
  gridRowSchema,
  naturalEntry,
  percentageEntry,
  savePerformancePayloadSchema,
  toCellErrors,
  weeklyCellField,
} from "@/lib/validation/data-entry";
import { hmSchema } from "@/lib/validation/hm";
import {
  findDuplicateWeekNumbers,
  salesWeekCalendarSchema,
  salesWeekRowSchema,
} from "@/lib/validation/sales-week";
import { isHmPhotoPathFor, hmPhotoPathFromPublicUrl, hmPhotoPath } from "@/lib/storage";
import type { HM, Month, SalesWeek } from "@/types/models";

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

// -----------------------------------------------------------------------------
// Fixtures. Names are obviously fictional - production HM names are never
// hardcoded, in the app or in its tests.
// -----------------------------------------------------------------------------

const MONTH_ID = randomUUID();

function hm(name: string, overrides: Partial<HM> = {}): HM {
  return {
    id: randomUUID(),
    name,
    office: "Sample Office",
    photo_url: null,
    status: "active",
    display_order: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function week(
  number: number,
  start: string,
  end: string,
  overrides: Partial<SalesWeek> = {},
): SalesWeek {
  return {
    id: randomUUID(),
    month_id: MONTH_ID,
    week_number: number,
    week_label: `W${number}`,
    start_date: start,
    end_date: end,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function month(year: number, m: number): Month {
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return {
    id: randomUUID(),
    year,
    month: m,
    label: `${names[m - 1]} ${year}`,
    quarter: Math.floor((m - 1) / 3) + 1,
    created_at: "2026-01-01T00:00:00Z",
  };
}

// Deliberately irregular and five long, crossing both month boundaries.
const WEEKS = [
  week(1, "2026-08-30", "2026-09-05"),
  week(2, "2026-09-06", "2026-09-12"),
  week(3, "2026-09-13", "2026-09-19"),
  week(4, "2026-09-20", "2026-09-26"),
  week(5, "2026-09-27", "2026-09-30"),
];

// =============================================================================
console.log("\n[S2-A] weekly Key-In: the monthly total is always derived");
// =============================================================================

check("sum of 20+18+13+21 is 72", sumKeyIn([20, 18, 13, 21, null]) === 72);
check(
  "blank weeks contribute nothing, they do not count as zero",
  sumKeyIn([20, null, null, null, null]) === 20,
);
check("a real zero week is summed as zero", sumKeyIn([20, 0, 0, 0]) === 20);
check("all blank sums to 0", sumKeyIn([null, null]) === 0);
check("hasAnyKeyIn false when every week is blank", !hasAnyKeyIn([null, null]));
check("hasAnyKeyIn true for an entered zero", hasAnyKeyIn([0, null]));
check("blank week count", countBlankWeeks([20, null, null, 0]) === 2);

console.log("\n[S2-B] weekly Key-In status bands: >15 green, 10-15 yellow, <10 red");
check("16 is green", weeklyKeyInStatus(16) === "green");
check("15 is YELLOW, not green (boundary)", weeklyKeyInStatus(15) === "yellow");
check("10 is yellow (boundary)", weeklyKeyInStatus(10) === "yellow");
check("9 is red (boundary)", weeklyKeyInStatus(9) === "red");
check("0 entered is red", weeklyKeyInStatus(0) === "red");
check(
  "blank is neutral, NOT red - nothing has been entered yet",
  weeklyKeyInStatus(null) === "neutral",
);

console.log("\n[S2-C] recruitment status: >=3 green, 1-2 yellow, 0 red");
check("3 is GREEN (boundary)", recruitmentStatus(3) === "green");
check("2 is YELLOW (boundary)", recruitmentStatus(2) === "yellow");
check("1 is yellow", recruitmentStatus(1) === "yellow");
check("0 is red", recruitmentStatus(0) === "red");
check("6 is green", recruitmentStatus(6) === "green");
check("blank is neutral", recruitmentStatus(null) === "neutral");

console.log("\n[S2-D] ratios");
check("28 of 76 is 36.8%", formatPercentage(percentageOf(28, 76)) === "36.8%");
check("48 of 76 is 63.2%", formatPercentage(percentageOf(48, 76)) === "63.2%");
check(
  "extrade + non-extrade percentages of a balanced split add to 100",
  Math.round(
    (extradePercentage(28, 76) ?? 0) + (nonExtradePercentage(48, 76) ?? 0),
  ) === 100,
);
check(
  "a zero denominator is null, not 0 - unknown is not the same as none",
  percentageOf(10, 0) === null && targetAchievement(50, 0) === null,
);
check("72 against a target of 100 is 72%", targetAchievement(72, 100) === 72);
check("achievement is null while Net is blank", targetAchievement(null, 100) === null);
check("null percentage renders as an em dash", formatPercentage(null) === "—");
check("blank entry renders as an em dash, never 0", formatEntry(null) === "—");
check("an entered zero renders as 0", formatEntry(0) === "0");

console.log("\n[S2-E] the Extrade identity");
check("28 + 48 = 76 balances", isSaveableSplit(76, 28, 48));
check("28 + 44 does not balance against 76", !isSaveableSplit(76, 28, 44));
check("Net 0 with a 0 split is saveable", isSaveableSplit(0, 0, 0));
check("Net 0 with blanks is saveable (blank saves as 0)", isSaveableSplit(null, null, null));
check("Net 0 with a non-zero split is rejected", !isSaveableSplit(0, 5, 0));
check(
  "Net entered but split still blank is not saveable",
  !isSaveableSplit(76, null, null),
);
check("remainder shows what is left to allocate", extradeRemainder(76, 28, 40) === 8);
check("remainder is negative when the split overshoots", extradeRemainder(76, 50, 40) === -14);
check(
  "remainder is null while any of the three is blank",
  extradeRemainder(76, 28, null) === null,
);

// =============================================================================
console.log("\n[S2-F] data-entry schemas: blank and zero are different values");
// =============================================================================

check("naturalEntry accepts null", naturalEntry("Target").safeParse(null).success);
check("naturalEntry accepts 0", naturalEntry("Target").safeParse(0).success);
check(
  "naturalEntry rejects a negative target",
  !naturalEntry("Target").safeParse(-1).success,
);
check(
  "naturalEntry rejects a fractional unit count",
  !naturalEntry("Net units").safeParse(4.5).success,
);
check(
  "the negative message names the field",
  naturalEntry("Recruitment").safeParse(-1).error?.issues[0]?.message ===
    "Recruitment cannot be negative.",
);
check("percentageEntry accepts null", percentageEntry("SHI").safeParse(null).success);
check("SHI of 100 accepted", percentageEntry("SHI").safeParse(100).success);
check("SHI of 100.01 rejected", !percentageEntry("SHI").safeParse(100.01).success);
check("SHI of -0.5 rejected", !percentageEntry("SHI").safeParse(-0.5).success);
check(
  "SHI with 3 decimals rejected (numeric(5,2))",
  !percentageEntry("SHI").safeParse(87.555).success,
);
check(
  "unlike the Stage 1 form schemas, null is NOT coerced to 0",
  naturalEntry("Net units").safeParse(null).data === null,
);

const balancedRow = {
  hm_id: randomUUID(),
  net_units: 72,
  target_net_units: 100,
  recruitment: 6,
  active_hp: 31,
  shi_percentage: 78,
  extrade_units: 28,
  non_extrade_units: 44,
  weekly: [{ week_id: WEEKS[0].id, keyin_units: 20 }],
};

check("a balanced grid row is accepted", gridRowSchema.safeParse(balancedRow).success);

const unbalanced = gridRowSchema.safeParse({ ...balancedRow, non_extrade_units: 40 });
check("an unbalanced grid row is rejected", !unbalanced.success);
if (!unbalanced.success) {
  const cells = toCellErrors(balancedRow.hm_id, unbalanced.error);
  check(
    "the error lands on BOTH extrade cells",
    cells.some((c) => c.field === "extrade_units") &&
      cells.some((c) => c.field === "non_extrade_units"),
    JSON.stringify(cells.map((c) => c.field)),
  );
  check(
    "the message names the actual numbers",
    cells[0].message.includes("68") && cells[0].message.includes("72"),
    cells[0].message,
  );
}

check(
  "Net 0 with a non-zero split is rejected with a Net-specific message",
  gridRowSchema
    .safeParse({
      ...balancedRow,
      net_units: 0,
      extrade_units: 3,
      non_extrade_units: 0,
    })
    .error?.issues[0]?.message.includes("Net Units is 0") === true,
);

check(
  "a row with everything blank is saveable (nothing entered yet)",
  gridRowSchema.safeParse({
    hm_id: balancedRow.hm_id,
    net_units: null,
    target_net_units: null,
    recruitment: null,
    active_hp: null,
    shi_percentage: null,
    extrade_units: null,
    non_extrade_units: null,
    weekly: [],
  }).success,
);

check(
  "the payload rejects more than six weekly cells in a row",
  !savePerformancePayloadSchema.safeParse({
    month_id: MONTH_ID,
    group_shi_percentage: 72,
    rows: [
      {
        ...balancedRow,
        weekly: Array.from({ length: 7 }, () => ({
          week_id: randomUUID(),
          keyin_units: 1,
        })),
      },
    ],
  }).success,
);

check(
  "the payload accepts a null group SHI (nothing entered from eTrust yet)",
  savePerformancePayloadSchema.safeParse({
    month_id: MONTH_ID,
    group_shi_percentage: null,
    rows: [],
  }).success,
);

check(
  "the payload rejects a group SHI above 100",
  !savePerformancePayloadSchema.safeParse({
    month_id: MONTH_ID,
    group_shi_percentage: 101,
    rows: [],
  }).success,
);

// =============================================================================
console.log("\n[S2-G] cell parsing: what the PA typed is preserved");
// =============================================================================

/** The parsed value, or `undefined` when the text does not parse at all. */
const parsed = (text: string) => {
  const result = toEntry(text);
  return result.ok ? result.value : undefined;
};

check('"" parses as null, not 0', parsed("") === null);
check('"0" parses as 0, not null', parsed("0") === 0);
check('"20" parses as 20', parsed("20") === 20);
check('"87.5" parses as 87.5', parsed("87.5") === 87.5);
check('"  12  " tolerates surrounding space', parsed("  12  ") === 12);
check('a lone "." is treated as still-typing, not an error', toEntry(".").ok);
check('"12a" is reported as unparseable', !toEntry("12a").ok);
check('"--5" is reported as unparseable', !toEntry("--5").ok);
check(
  '"-5" parses so the schema can say "cannot be negative"',
  parsed("-5") === -5,
);
check("null renders as an empty cell", entryToText(null) === "");
check("0 renders as \"0\"", entryToText(0) === "0");
check(
  'numeric(5,2) 87.50 renders as "87.5"',
  entryToText(87.5) === "87.5",
);

// =============================================================================
console.log("\n[S2-H] the grid model: building, dirtiness and payload shaping");
// =============================================================================

const alisha = hm("Sample HM A", { display_order: 1 });
const syila = hm("Sample HM B", { display_order: 2 });
const HMS = [alisha, syila];

const baseline = buildDraft({
  hms: HMS,
  weeks: WEEKS,
  monthly: [
    {
      id: randomUUID(),
      hm_id: alisha.id,
      month_id: MONTH_ID,
      net_units: 72,
      target_net_units: 100,
      recruitment: 6,
      active_hp: 31,
      shi_percentage: 78,
      extrade_units: 28,
      non_extrade_units: 44,
      created_at: "",
      updated_at: "",
      created_by: null,
      updated_by: null,
    },
  ],
  weekly: [
    {
      id: randomUUID(),
      hm_id: alisha.id,
      week_id: WEEKS[0].id,
      keyin_units: 20,
      created_at: "",
      updated_at: "",
      created_by: null,
      updated_by: null,
    },
  ],
  groupMetrics: null,
});

check(
  "a saved row is loaded into the grid",
  baseline.rows[alisha.id].monthly.net_units === "72" &&
    baseline.rows[alisha.id].weekly[WEEKS[0].id] === "20",
);
check(
  "an HM with no saved row gets BLANK cells, not zeros",
  Object.values(baseline.rows[syila.id].monthly).every((v) => v === "") &&
    Object.values(baseline.rows[syila.id].weekly).every((v) => v === ""),
);
check(
  "weeks with no figure are blank even for an HM that has some",
  baseline.rows[alisha.id].weekly[WEEKS[1].id] === "",
);
check(
  "a missing group SHI row leaves the input empty",
  baseline.groupShi === "",
);

const edited = structuredClone(baseline);
edited.rows[alisha.id].weekly[WEEKS[1].id] = "18";

check(
  "editing one week marks only that row dirty",
  dirtyRowIds(edited, baseline, HMS, WEEKS).join() === alisha.id,
);
check(
  "re-typing the same figure differently is not a change (87.50 vs 87.5)",
  !isRowDirty(
    { ...baseline.rows[alisha.id], monthly: { ...baseline.rows[alisha.id].monthly, shi_percentage: "78.00" } },
    baseline.rows[alisha.id],
    WEEKS,
  ),
);
check(
  "only the changed weekly cell is sent",
  changedWeeklyCells(edited.rows[alisha.id], baseline.rows[alisha.id], WEEKS)
    .length === 1,
);
check(
  "the changed cell carries the new value",
  changedWeeklyCells(edited.rows[alisha.id], baseline.rows[alisha.id], WEEKS)[0]
    .keyin_units === 18,
);

const zeroed = structuredClone(baseline);
zeroed.rows[alisha.id].weekly[WEEKS[1].id] = "0";
check(
  "entering a real 0 in a blank week IS a change",
  isRowDirty(zeroed.rows[alisha.id], baseline.rows[alisha.id], WEEKS),
);
check(
  "and it is sent as 0, not dropped as blank",
  changedWeeklyCells(zeroed.rows[alisha.id], baseline.rows[alisha.id], WEEKS)[0]
    .keyin_units === 0,
);

const clearedDraft = structuredClone(baseline);
clearedDraft.rows[alisha.id].weekly[WEEKS[0].id] = "";
check(
  "blanking a SAVED week is detected (manager-only removal)",
  findClearedSavedWeeks(clearedDraft, baseline, HMS, WEEKS).length === 1,
);
check(
  "blanking an already-blank week is not a removal",
  findClearedSavedWeeks(baseline, baseline, HMS, WEEKS).length === 0,
);

const shiDraft = structuredClone(baseline);
shiDraft.groupShi = "72";
check("a group SHI edit is tracked separately", isGroupShiDirty(shiDraft, baseline));
check("an untouched group SHI is not dirty", !isGroupShiDirty(baseline, baseline));

check(
  "monthlyValues parses the whole row for the payload",
  monthlyValues(baseline.rows[alisha.id]).net_units === 72 &&
    monthlyValues(baseline.rows[syila.id]).net_units === null,
);
check(
  "weeklyEntries follows configured week order",
  weeklyEntries(baseline.rows[alisha.id], WEEKS).join() === "20,,,,",
);
check(
  "rowValues carries the HM id through to the schema",
  rowValues(baseline.rows[alisha.id], WEEKS).hm_id === alisha.id,
);

// =============================================================================
console.log("\n[S2-I] live row validation");
// =============================================================================

const partial: RowDraft = {
  hmId: alisha.id,
  monthly: {
    net_units: "76",
    target_net_units: "100",
    recruitment: "",
    active_hp: "",
    shi_percentage: "",
    extrade_units: "",
    non_extrade_units: "",
  },
  weekly: { [WEEKS[0].id]: "20" },
};

check(
  "an in-progress row with Net set but no split yet is NOT flagged while typing",
  Object.keys(validateRow(partial, WEEKS)).length === 0,
);
check(
  "the same row IS flagged once it is about to be saved",
  Boolean(validateRow(partial, WEEKS, { requireBalance: true }).extrade_units),
);
check(
  "unparseable text is reported on the exact cell",
  validateRow(
    { ...partial, monthly: { ...partial.monthly, recruitment: "3x" } },
    WEEKS,
  ).recruitment === "Recruitment must be a number.",
);
check(
  "an unparseable weekly cell is reported on that week",
  Boolean(
    validateRow({ ...partial, weekly: { [WEEKS[1].id]: "abc" } }, WEEKS)[
      weeklyCellField(WEEKS[1].id)
    ],
  ),
);
check(
  "a negative target is flagged immediately, without waiting for save",
  Boolean(
    validateRow(
      { ...partial, monthly: { ...partial.monthly, target_net_units: "-5" } },
      WEEKS,
    ).target_net_units,
  ),
);
check(
  "SHI above 100 is flagged immediately",
  Boolean(
    validateRow(
      { ...partial, monthly: { ...partial.monthly, shi_percentage: "120" } },
      WEEKS,
    ).shi_percentage,
  ),
);
check(
  "a negative Active HP is flagged",
  Boolean(
    validateRow(
      { ...partial, monthly: { ...partial.monthly, active_hp: "-1" } },
      WEEKS,
    ).active_hp,
  ),
);
check(
  "a negative weekly Key-In is flagged",
  Boolean(
    validateRow({ ...partial, weekly: { [WEEKS[0].id]: "-3" } }, WEEKS)[
      weeklyCellField(WEEKS[0].id)
    ],
  ),
);
check(
  "a complete, balanced row is clean even under the save-time rule",
  Object.keys(
    validateRow(
      {
        hmId: alisha.id,
        monthly: {
          net_units: "72",
          target_net_units: "100",
          recruitment: "6",
          active_hp: "31",
          shi_percentage: "78",
          extrade_units: "28",
          non_extrade_units: "44",
        },
        weekly: {},
      },
      WEEKS,
      { requireBalance: true },
    ),
  ).length === 0,
);

// =============================================================================
console.log("\n[S2-J] data completeness");
// =============================================================================

const blankRow = (id: string): CompletenessRow => ({
  hmId: id,
  net_units: null,
  target_net_units: null,
  recruitment: null,
  active_hp: null,
  shi_percentage: null,
  extrade_units: null,
  non_extrade_units: null,
  weekly: [null, null],
});

check("an untouched row has no data", !hasRecordedData(blankRow("a")));
check(
  "a single weekly figure counts as data",
  hasRecordedData({ ...blankRow("a"), weekly: [20, null] }),
);
check(
  "a zero week counts as data - somebody entered it",
  hasRecordedData({ ...blankRow("a"), weekly: [0, null] }),
);
check(
  "a target set before the month starts counts as data",
  hasRecordedData({ ...blankRow("a"), target_net_units: 100 }),
);

const summary = summariseCompleteness([
  { ...blankRow("a"), net_units: 72, extrade_units: 28, non_extrade_units: 44 },
  { ...blankRow("b"), weekly: [18, null] },
  blankRow("c"),
  blankRow("d"),
]);
check("counts the HMs with figures", summary.withData === 2 && summary.total === 4);
check("names the ones still missing", summary.missingHmIds.join() === "c,d");
check("4 of 4 reads as complete", summariseCompleteness([
  { ...blankRow("a"), net_units: 1, extrade_units: 1, non_extrade_units: 0 },
]).level === "complete");
check("a partly-entered month reads as partial", summary.level === "partial");
check(
  "nothing entered at all reads as empty",
  summariseCompleteness([blankRow("a"), blankRow("b")]).level === "empty",
);
check(
  "no active HMs is empty, not complete",
  summariseCompleteness([]).level === "empty",
);
check(
  "toCompletenessRow reads a draft straight into the summary",
  hasRecordedData(toCompletenessRow(baseline.rows[alisha.id], WEEKS)) &&
    !hasRecordedData(toCompletenessRow(baseline.rows[syila.id], WEEKS)),
);

// =============================================================================
console.log("\n[S2-K] the Coway sales calendar");
// =============================================================================

const validCalendar = {
  month_id: MONTH_ID,
  weeks: [
    { week_number: 1, start_date: "2026-08-30", end_date: "2026-09-05" },
    { week_number: 2, start_date: "2026-09-06", end_date: "2026-09-12" },
    { week_number: 3, start_date: "2026-09-13", end_date: "2026-09-19" },
    { week_number: 4, start_date: "2026-09-20", end_date: "2026-09-26" },
    { week_number: 5, start_date: "2026-09-27", end_date: "2026-09-30" },
  ],
};

check(
  "a five-week month starting in the PREVIOUS month is accepted",
  salesWeekCalendarSchema.safeParse(validCalendar).success,
);
check(
  "a six-week month is accepted",
  salesWeekCalendarSchema.safeParse({
    month_id: MONTH_ID,
    weeks: [
      ...validCalendar.weeks.slice(0, 4),
      { week_number: 5, start_date: "2026-09-27", end_date: "2026-09-29" },
      { week_number: 6, start_date: "2026-09-30", end_date: "2026-10-03" },
    ],
  }).success,
);
check(
  "a seventh week is rejected",
  !salesWeekCalendarSchema.safeParse({
    month_id: MONTH_ID,
    weeks: Array.from({ length: 7 }, (_, i) => ({
      week_number: (i % 6) + 1,
      start_date: "2026-09-01",
      end_date: "2026-09-02",
    })),
  }).success,
);
check(
  "week 0 is rejected",
  !salesWeekRowSchema.safeParse({
    week_number: 0,
    start_date: "2026-09-01",
    end_date: "2026-09-07",
  }).success,
);
check(
  "an end date before the start date is rejected",
  !salesWeekRowSchema.safeParse({
    week_number: 1,
    start_date: "2026-09-10",
    end_date: "2026-09-01",
  }).success,
);
check(
  "a single-day period is fine (start == end)",
  salesWeekRowSchema.safeParse({
    week_number: 1,
    start_date: "2026-09-30",
    end_date: "2026-09-30",
  }).success,
);
check(
  "a nine-day period is fine - Coway weeks are not seven days",
  salesWeekRowSchema.safeParse({
    week_number: 2,
    start_date: "2026-09-05",
    end_date: "2026-09-13",
  }).success,
);

const duplicated = salesWeekCalendarSchema.safeParse({
  month_id: MONTH_ID,
  weeks: [
    { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-07" },
    { week_number: 1, start_date: "2026-09-08", end_date: "2026-09-14" },
  ],
});
check("a duplicate week number is rejected", !duplicated.success);
check(
  "the duplicate message names the week",
  duplicated.error?.issues[0]?.message.includes("Week 1") === true,
  duplicated.error?.issues[0]?.message,
);
check(
  "findDuplicateWeekNumbers reports every repeat, sorted",
  findDuplicateWeekNumbers([
    { week_number: 3 },
    { week_number: 1 },
    { week_number: 3 },
    { week_number: 1 },
  ]).join() === "1,3",
);

const overlapping = salesWeekCalendarSchema.safeParse({
  month_id: MONTH_ID,
  weeks: [
    { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-10" },
    { week_number: 2, start_date: "2026-09-08", end_date: "2026-09-15" },
  ],
});
check("overlapping periods are rejected", !overlapping.success);
check(
  "the overlap message says which two weeks clash",
  overlapping.error?.issues[0]?.message.includes("W1") === true &&
    overlapping.error?.issues[0]?.message.includes("W2") === true,
  overlapping.error?.issues[0]?.message,
);
check(
  "sharing a single day still counts as an overlap",
  !salesWeekCalendarSchema.safeParse({
    month_id: MONTH_ID,
    weeks: [
      { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-07" },
      { week_number: 2, start_date: "2026-09-07", end_date: "2026-09-13" },
    ],
  }).success,
);
check(
  "back-to-back periods are NOT an overlap",
  salesWeekCalendarSchema.safeParse({
    month_id: MONTH_ID,
    weeks: [
      { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-07" },
      { week_number: 2, start_date: "2026-09-08", end_date: "2026-09-13" },
    ],
  }).success,
);

console.log("\n[S2-L] calendar helpers");
check("next free week number fills a gap first", nextAvailableWeekNumber([
  { week_number: 1 },
  { week_number: 2 },
  { week_number: 4 },
]) === 3);
check(
  "next free week number is null once six exist",
  nextAvailableWeekNumber(
    Array.from({ length: 6 }, (_, i) => ({ week_number: i + 1 })),
  ) === null,
);
check(
  "a suggested range starts the day after the last week ends",
  suggestWeekRange([{ end_date: "2026-09-12" }], { year: 2026, month: 9 })
    .start_date === "2026-09-13",
);
check(
  "the first suggested week starts on the 1st of the month",
  suggestWeekRange([], { year: 2026, month: 9 }).start_date === "2026-09-01",
);
check("addDays crosses a month boundary", addDays("2026-09-30", 1) === "2026-10-01");
check("addDays crosses a year boundary", addDays("2026-12-31", 1) === "2027-01-01");
check(
  "a week range reads as a short span",
  formatWeekRange({ start_date: "2026-08-30", end_date: "2026-09-05" }) ===
    "30 Aug – 5 Sep",
);

// =============================================================================
console.log("\n[S2-M] month selection");
// =============================================================================

const SEP = month(2026, 9);
const AUG = month(2026, 8);
const JUL = month(2026, 7);
const MONTHS = [SEP, AUG, JUL]; // newest first, as listMonths() returns them

check(
  "an explicitly requested month wins",
  resolveSelectedMonth(MONTHS, AUG.id)?.id === AUG.id,
);
check(
  "today's month is used when nothing is requested",
  resolveSelectedMonth(MONTHS, undefined, new Date("2026-08-15T00:00:00Z"))?.id ===
    AUG.id,
);
check(
  "an unknown id falls back rather than erroring",
  resolveSelectedMonth(MONTHS, randomUUID(), new Date("2026-08-15T00:00:00Z"))
    ?.id === AUG.id,
);
check(
  "with no month for today, the most recent one is used",
  resolveSelectedMonth(MONTHS, undefined, new Date("2027-03-01T00:00:00Z"))?.id ===
    SEP.id,
);
check("no months at all resolves to null", resolveSelectedMonth([], undefined) === null);
check(
  "previous and next step through existing months",
  findMonthNeighbours(MONTHS, AUG.id).previous?.id === JUL.id &&
    findMonthNeighbours(MONTHS, AUG.id).next?.id === SEP.id,
);
check(
  "the earliest month has no previous",
  findMonthNeighbours(MONTHS, JUL.id).previous === null,
);
check(
  "the latest month has no next",
  findMonthNeighbours(MONTHS, SEP.id).next === null,
);
const JAN_2027 = month(2027, 1);
const DEC_2026 = month(2026, 12);
check(
  "neighbours cross a year boundary in the right order",
  findMonthNeighbours([JAN_2027, DEC_2026], JAN_2027.id).previous?.id ===
    DEC_2026.id &&
    findMonthNeighbours([JAN_2027, DEC_2026], DEC_2026.id).next?.id ===
      JAN_2027.id,
);
check(
  "the current month is found when it exists",
  findCurrentMonth(MONTHS, new Date("2026-09-20T00:00:00Z"))?.id === SEP.id,
);
check(
  "and is null when it has not been opened",
  findCurrentMonth(MONTHS, new Date("2026-11-01T00:00:00Z")) === null,
);
check("months sort oldest first", sortMonthsAscending(MONTHS)[0].id === JUL.id);
check("a month label falls back to being derived", monthLabel({ ...SEP, label: "  " }) === "September 2026");

// =============================================================================
console.log("\n[S2-N] HM records and photos");
// =============================================================================

check(
  "an HM needs a name and an office",
  !hmSchema.safeParse({ name: "A", office: "  ", status: "active" }).success,
);
check(
  "a valid HM is accepted with a display order",
  hmSchema.safeParse({
    name: "Sample HM A",
    office: "Sample Office",
    status: "active",
    display_order: 3,
  }).success,
);
check(
  "deactivating is just a status change, and is valid",
  hmSchema.safeParse({
    name: "Sample HM A",
    office: "Sample Office",
    status: "inactive",
  }).success,
);
check(
  "an unknown status is rejected",
  !hmSchema.safeParse({
    name: "Sample HM A",
    office: "Sample Office",
    status: "archived",
  }).success,
);
check(
  "a negative display order is rejected",
  !hmSchema.safeParse({
    name: "A",
    office: "B",
    status: "active",
    display_order: -1,
  }).success,
);

const photoHmId = randomUUID();
const generatedPath = hmPhotoPath(photoHmId, "headshot.PNG");
check(
  "a generated photo path is accepted for its own HM",
  isHmPhotoPathFor(photoHmId, generatedPath),
  generatedPath,
);
check(
  "a path for a DIFFERENT HM is rejected",
  !isHmPhotoPathFor(randomUUID(), generatedPath),
);
check(
  "a traversal attempt is rejected",
  !isHmPhotoPathFor(photoHmId, `${photoHmId}/../../secret.png`),
);
check(
  "an absolute URL is rejected - the client never supplies the URL",
  !isHmPhotoPathFor(photoHmId, "https://tracker.example/pixel.png"),
);
check(
  "an executable extension is rejected",
  !isHmPhotoPathFor(photoHmId, `${photoHmId}/123.svg`),
);
check(
  "the storage path is recovered from one of our public URLs",
  hmPhotoPathFromPublicUrl(
    `https://abc.supabase.co/storage/v1/object/public/hm-photos/${photoHmId}/123.png`,
  ) === `${photoHmId}/123.png`,
);
check(
  "a foreign URL yields no path, so nothing of theirs is deleted",
  hmPhotoPathFromPublicUrl("https://example.com/someone-else.png") === null,
);
check("a null photo_url yields no path", hmPhotoPathFromPublicUrl(null) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
