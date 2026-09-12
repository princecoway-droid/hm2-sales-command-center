/**
 * Stage 5 tests: the HM detail screen.
 *
 *   npm run test:stage5
 *
 * Same shape as Stages 1-4 - plain Node, no framework, one file, the Stage 3
 * fixtures reused so a scenario is a spec rather than a page of literal rows.
 *
 * ---------------------------------------------------------------------------
 * What is being tested, and what deliberately is not
 * ---------------------------------------------------------------------------
 * NOT the formulas. Achievement, Net Ratio, the Key-In total, the Extrade
 * split, the status bands, MoM and QTD are proved in `stage3.test.mts` against
 * the engine, and re-dividing Net by Target here would only prove that the test
 * can divide.
 *
 * What IS tested is the join: that the figure labelled Achievement on an HM's
 * own screen is the ENGINE's achievement, that a blank week reaches it as blank
 * rather than as a zero, that every "no data" case reads as missing rather than
 * as bad - and above all that an HM's Net on their own screen is the SAME
 * figure as their Net on the dashboard, which is the one regression this stage
 * exists to make impossible.
 *
 * The presenter is the seam that makes this possible without a DOM: components
 * receive already-formatted strings and lay them out, so asserting on the
 * presenter's output is asserting on what renders.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  calculateMetricMonthComparison,
  formatPercentage,
  formatUnits,
} from "@/lib/calculations";
import { monthParam, parseMonthParam, resolveDashboardMonth } from "@/lib/calendar";
import { dashboardPath, hmDetailPath, ROUTES } from "@/lib/routes";
import { buildDashboardViewModel } from "@/lib/view-models/dashboard";
import {
  buildHmDetailViewModel,
  statusWord,
  type HmDetailViewModel,
} from "@/lib/view-models/hm-detail";
import {
  buildHmPerformanceViewModel,
  buildMonthlyPerformanceViewModel,
  type MonthPerformanceRecords,
  type PerformanceBundle,
} from "@/lib/view-models/monthly-performance";
import {
  FOUR_WEEKS,
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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function bundleOf(
  roster: Roster,
  months: MonthPerformanceRecords[],
  selected: MonthPerformanceRecords,
  groupShiPct: number | null = null,
): PerformanceBundle {
  return {
    selectedMonthId: selected.month.id,
    hms: rosterList(roster),
    months,
    groupShiPct,
  };
}

/** One HM's whole screen, exactly as the route builds it. */
function detailOf(
  roster: Roster,
  months: MonthPerformanceRecords[],
  selected: MonthPerformanceRecords,
  name: string,
  { lastUpdatedAt = null }: { lastUpdatedAt?: string | null } = {},
): HmDetailViewModel {
  const bundle = bundleOf(roster, months, selected);
  const model = buildHmPerformanceViewModel(bundle, hmId(roster, name));

  if (!model) {
    throw new Error(`Fixture error: no HM model for "${name}".`);
  }

  return buildHmDetailViewModel({
    selectedMonth: selected.month,
    model,
    lastUpdatedAt,
  });
}

function metric(detail: HmDetailViewModel, key: string) {
  const found = detail.secondary.find((entry) => entry.key === key);

  if (!found) {
    throw new Error(`No secondary metric for "${key}".`);
  }

  return found;
}

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

function read(relative: string): string {
  return readFileSync(path.join(SRC, relative), "utf8");
}

const close = (a: number | null, b: number, tolerance = 0.05) =>
  a !== null && Math.abs(a - b) < tolerance;

// -----------------------------------------------------------------------------
// The scenario every section reads from
// -----------------------------------------------------------------------------

/**
 * The live September the acceptance criteria describe, plus the team around it.
 *
 * Alisha's figures are the ones Stage 5 is verified against end to end:
 * W1-W4 = 20/18/13/21 with W5 blank, Net 72, Target 100, Recruitment 6,
 * Active HP 31, SHI 78, Extrade 28 / Non-Extrade 44.
 */
const TEAM = createRoster([
  "Alisha",
  "Bravo",
  "Charlie",
  { name: "Departed", status: "inactive", displayOrder: 9 },
]);

const JULY = buildMonthRecords(TEAM, {
  year: 2026,
  month: 7,
  weeks: FOUR_WEEKS,
  hms: {
    Alisha: {
      monthly: { net: 60, target: 90, recruitment: 2, activeHp: 28, shi: 66 },
      weekly: [16, 15, 14, 15],
    },
    Bravo: { monthly: { net: 40, target: 80, recruitment: 1 }, weekly: [10, 10, 10, 10] },
    Departed: { monthly: { net: 25, target: 50, recruitment: 1 }, weekly: [7, 6, 6, 6] },
  },
});

const AUGUST = buildMonthRecords(TEAM, {
  year: 2026,
  month: 8,
  weeks: FOUR_WEEKS,
  hms: {
    Alisha: {
      monthly: { net: 11, target: 100, recruitment: 4, activeHp: 26, shi: 64 },
      weekly: [4, 3, 2, 4],
    },
    Bravo: { monthly: { net: 45, target: 80, recruitment: 3 }, weekly: [12, 11, 11, 11] },
  },
});

const SEPTEMBER = buildMonthRecords(TEAM, {
  year: 2026,
  month: 9,
  hms: {
    Alisha: {
      monthly: {
        net: 72,
        target: 100,
        recruitment: 6,
        activeHp: 31,
        shi: 78,
        extrade: 28,
        nonExtrade: 44,
      },
      weekly: [20, 18, 13, 21, null],
    },
    Bravo: {
      monthly: { net: 54, target: 80, recruitment: 2, activeHp: 24, shi: 61 },
      weekly: [14, 12, 16, null, null],
    },
    // Charlie is active with nothing entered at all - the "no record" case.
  },
});

const MONTHS = [JULY, AUGUST, SEPTEMBER];

// =============================================================================
section("[1] the route, and the month it carries");
// =============================================================================

{
  check(
    // A sibling of /dashboard, not a child: nested, it would inherit the
    // dashboard's loading skeleton on a hard load.
    "the HM screen is its own top-level segment",
    ROUTES.hmDetail === "/hm",
  );

  check(
    "an HM link carries the reporting month",
    hmDetailPath("abc-123", "2026-09") === "/hm/abc-123?month=2026-09",
  );

  check(
    "...and is a bare path when there is no month to carry",
    hmDetailPath("abc-123") === "/hm/abc-123",
  );

  check(
    "an id with URL-significant characters is encoded, never interpolated raw",
    hmDetailPath("a/b?c=1") === "/hm/a%2Fb%3Fc%3D1",
  );

  check(
    "back to the dashboard keeps the month",
    dashboardPath("2026-08") === "/dashboard?month=2026-08",
  );

  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha");

  check(
    "the screen's own back link carries the month being viewed",
    detail.backHref === "/dashboard?month=2026-09",
  );

  check(
    "the month is stated, never left to be inferred",
    detail.month.label === "September 2026" &&
      detail.month.param === "2026-09" &&
      detail.month.quarterLabel === "Q3 2026",
  );

  // The URL contract is the dashboard's, unchanged - so a refresh, a bookmark
  // and a shared link all land on the same month.
  check(
    "the month round-trips: month -> param -> month",
    monthParam(SEPTEMBER.month) === "2026-09" &&
      resolveDashboardMonth(
        [SEPTEMBER.month, AUGUST.month],
        parseMonthParam("2026-09"),
      ).month?.id === SEPTEMBER.month.id,
  );
}

// =============================================================================
section("[2] the dashboard card is the way in, and it carries the month");
// =============================================================================

{
  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, MONTHS, SEPTEMBER),
  )!;

  const dashboard = buildDashboardViewModel({
    selectedMonth: SEPTEMBER.month,
    performance,
    lastUpdatedAt: null,
  });

  const card = dashboard.hms.find((entry) => entry.name === "Alisha")!;

  check(
    "every HM card links to that HM on the month being viewed",
    dashboard.hms.every(
      (entry) => entry.href === `/hm/${entry.hmId}?month=2026-09`,
    ),
  );

  check(
    "the link points at the HM whose card it is",
    card.href.includes(hmId(TEAM, "Alisha")),
  );

  const august = buildDashboardViewModel({
    selectedMonth: AUGUST.month,
    performance: buildMonthlyPerformanceViewModel(
      bundleOf(TEAM, MONTHS, AUGUST),
    )!,
    lastUpdatedAt: null,
  });

  check(
    "on an August dashboard the cards link to August, not to today",
    august.hms.every((entry) => entry.href.endsWith("?month=2026-08")),
  );
}

// =============================================================================
section("[3] the header identifies the HM and the month");
// =============================================================================

{
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha", {
    lastUpdatedAt: "2026-09-04T06:32:00Z",
  });

  check(
    "the HM's name and office are carried through untouched",
    detail.hm.name === "Alisha" && detail.hm.office === "Sample Office",
  );

  check(
    "an active HM is not badged inactive",
    detail.hm.isActive === true,
  );

  check(
    "the photo is passed through, null when there is none, for the initials fallback",
    detail.hm.photoUrl === null,
  );

  check(
    "the ranking position comes from the engine's ranking, out of the month's HMs",
    detail.hm.rankLabel === "Rank 1 of 3",
    `got ${detail.hm.rankLabel}`,
  );

  check(
    // 06:32 UTC is 14:32 in Kuala Lumpur. The month's spelling is the runtime
    // ICU's business; the +8 shift is this application's.
    "the updated stamp is the data's own, converted to the reporting timezone",
    detail.updatedLabel !== null &&
      detail.updatedLabel.includes("2026, 14:32") &&
      !detail.updatedLabel.includes("06:32"),
    `got ${detail.updatedLabel}`,
  );

  const never = detailOf(TEAM, MONTHS, SEPTEMBER, "Charlie");

  check(
    "an HM with nothing recorded has no updated stamp invented for them",
    never.updatedLabel === null,
  );
}

// =============================================================================
section("[4] the primary figures are the engine's");
// =============================================================================

{
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha");

  const bundle = bundleOf(TEAM, MONTHS, SEPTEMBER);
  const engine = buildHmPerformanceViewModel(bundle, hmId(TEAM, "Alisha"))!
    .performance;

  check("Net is the engine's Net", detail.net.value === formatUnits(72));
  check("Target is the engine's target", detail.target.value === formatUnits(100));

  check(
    "Achievement is the ENGINE's achievement, not a division done here",
    detail.achievement.value ===
      formatPercentage(engine.achievementPct, { fallback: "—" }) &&
      detail.achievement.value === "72.0%",
    `got ${detail.achievement.value}`,
  );

  check(
    "Key-In is the SUM of the entered weeks, never a stored field",
    detail.keyIn.value === formatUnits(72) && engine.totalKeyIn === 72,
    `got ${detail.keyIn.value}`,
  );

  check(
    "Net ratio is the engine's, Net over the derived Key-In",
    detail.netRatio.value ===
      formatPercentage(engine.netRatioPct, { fallback: "—" }) &&
      detail.netRatio.value === "100.0%",
    `got ${detail.netRatio.value}`,
  );

  check(
    "the target track shows the same achievement it reports in text",
    detail.targetProgress.hasTarget &&
      detail.targetProgress.achievementLabel === detail.achievement.value &&
      close(detail.targetProgress.progressPct, 72),
  );

  check(
    "real figures carry their unit, so nothing reads as a bare number",
    detail.net.unit === "units" && detail.target.unit === "units",
  );
}

// =============================================================================
section("[5] achievement over 100%, and a target of zero");
// =============================================================================

{
  const roster = createRoster(["Over"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Over: { monthly: { net: 118, target: 100 }, weekly: [30, 30, 30, 28] } },
  });

  const detail = detailOf(roster, [month], month, "Over");

  check(
    "118 against 100 reads as 118.0%, not as a capped 100%",
    detail.achievement.value === "118.0%",
  );

  check(
    "...while the bar is clamped, so it fills its track instead of overflowing",
    detail.targetProgress.progressPct === 100,
  );
}

{
  const roster = createRoster(["NoTarget"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { NoTarget: { monthly: { net: 40, target: 0 }, weekly: [20, 20] } },
  });

  const detail = detailOf(roster, [month], month, "NoTarget");

  check(
    "a target of 0 gives no achievement - never Infinity, NaN or 0%",
    detail.achievement.value === "—",
  );

  check(
    "...and it says the target is not set rather than showing a zero target",
    detail.target.value === formatUnits(0) &&
      detail.target.note === "Target not set",
    `got value=${detail.target.value} note=${detail.target.note}`,
  );

  check(
    "...and there is no progress bar to draw",
    detail.targetProgress.hasTarget === false &&
      detail.targetProgress.progressPct === null,
  );

  check(
    "achievement explains itself instead of leaving a bare dash",
    detail.achievement.note === "Needs a target",
  );
}

{
  // Net of 0, entered. A real zero month, not a missing one.
  const roster = createRoster(["Zero"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Zero: { monthly: { net: 0, target: 60 }, weekly: [0, 0] } },
  });

  const detail = detailOf(roster, [month], month, "Zero");

  check(
    "an entered zero Net shows as 0, not as a dash",
    detail.net.value === formatUnits(0),
  );

  check(
    "0 against a target of 60 is a real 0.0% achievement",
    detail.achievement.value === "0.0%",
  );

  check(
    "an entered zero week counts as entered, so Key-In is a real 0",
    detail.keyIn.value === formatUnits(0) && detail.weekly.weeksEntered === 2,
  );

  check(
    "net ratio is unknown when nothing was keyed in, not 0%",
    detail.netRatio.value === "—" && detail.netRatio.note === "Needs Key-In",
  );
}

// =============================================================================
section("[6] the weekly section is driven by the Coway calendar");
// =============================================================================

{
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha");

  check(
    "every configured week appears, in calendar order",
    detail.weekly.weeks.map((week) => week.label).join(",") ===
      "W1,W2,W3,W4,W5",
  );

  check(
    "the dates are the configured Coway periods, never derived from the month",
    detail.weekly.weeks[0]!.rangeLabel === "30 Aug – 5 Sep",
    `got ${detail.weekly.weeks[0]!.rangeLabel}`,
  );

  check(
    "W1 starting in the PREVIOUS calendar month survives to the screen",
    detail.weekly.weeks[0]!.rangeLabel.startsWith("30 Aug"),
  );

  check(
    "the figures are the ones keyed in: 20, 18, 13, 21",
    detail.weekly.weeks.slice(0, 4).map((week) => week.unitsLabel).join(",") ===
      "20,18,13,21",
  );

  const w5 = detail.weekly.weeks[4]!;

  check(
    "a blank week is an em dash, never a zero",
    w5.unitsLabel === "—" && !w5.isEntered,
  );

  check(
    "...and it is NEUTRAL, never red - the week has not happened yet",
    w5.status === "neutral" && w5.statusLabel === "NEUTRAL",
  );

  check(
    "...and it is given no bar length",
    w5.barPct === 0,
  );

  check(
    "the total is the engine's sum of the entered weeks",
    detail.weekly.totalLabel === formatUnits(72),
  );

  check(
    "how much of the calendar is filled in is stated as a count",
    detail.weekly.entriesLabel === "4 of 5 weeks entered" &&
      detail.weekly.weeksEntered === 4 &&
      detail.weekly.weeksConfigured === 5,
  );

  check(
    "the tallest ENTERED week sets the scale, so 21 is full length",
    detail.weekly.weeks[3]!.barPct === 100,
  );

  check(
    "...and a shorter week is scaled against it, not against a blank one",
    close(detail.weekly.weeks[2]!.barPct, (13 / 21) * 100),
  );
}

// =============================================================================
section("[7] weekly status uses the locked bands, applied by the engine");
// =============================================================================

{
  // 16 green (>15), 15 yellow (10-15), 10 yellow (boundary), 9 red (<10).
  const roster = createRoster(["Bands"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Bands: { monthly: { net: 50, target: 60 }, weekly: [16, 15, 10, 9, null] } },
  });

  const detail = detailOf(roster, [month], month, "Bands");
  const statuses = detail.weekly.weeks.map((week) => week.status).join(",");

  check(
    "16 green, 15 yellow, 10 yellow, 9 red, blank neutral",
    statuses === "green,yellow,yellow,red,neutral",
    `got ${statuses}`,
  );

  check(
    "each band is written out in words, so colour is never the only signal",
    detail.weekly.weeks.map((week) => week.statusLabel).join(",") ===
      "GREEN,YELLOW,YELLOW,RED,NEUTRAL",
  );

  check(
    "the words come from one place, shared with everything else that names a band",
    statusWord("green") === "GREEN" && statusWord("neutral") === "NEUTRAL",
  );
}

// =============================================================================
section("[8] W6 months, and a month with no calendar at all");
// =============================================================================

{
  const roster = createRoster(["Six"]);
  const SIX_WEEKS = [
    ["2026-08-30", "2026-09-05"],
    ["2026-09-06", "2026-09-12"],
    ["2026-09-13", "2026-09-19"],
    ["2026-09-20", "2026-09-26"],
    ["2026-09-27", "2026-10-03"],
    ["2026-10-04", "2026-10-06"],
  ] as const;

  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: SIX_WEEKS,
    hms: { Six: { monthly: { net: 60, target: 80 }, weekly: [12, 11, 10, 9, 8, 10] } },
  });

  const detail = detailOf(roster, [month], month, "Six");

  check(
    "six configured weeks all render - the count is never assumed to be four",
    detail.weekly.weeks.length === 6 &&
      detail.weekly.weeks[5]!.label === "W6",
  );

  check(
    "a six-week month totals all six",
    detail.weekly.totalLabel === formatUnits(60),
  );
}

{
  const roster = createRoster(["NoWeeks"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: [],
    hms: { NoWeeks: { monthly: { net: 30, target: 50 } } },
  });

  const detail = detailOf(roster, [month], month, "NoWeeks");

  check(
    "a month with no sales calendar says so rather than showing an empty chart",
    detail.weekly.hasWeeks === false && detail.weekly.weeks.length === 0,
  );

  check(
    "...and its Key-In is blank, not a zero",
    detail.weekly.totalLabel === "—" && detail.keyIn.value === "—",
  );

  check(
    "...while the monthly figures that DO exist still render",
    detail.net.value === formatUnits(30),
  );
}

// =============================================================================
section("[9] recruitment, Active HP and SHI");
// =============================================================================

{
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha");

  const recruitment = metric(detail, "recruitment");

  check(
    "recruitment is the month's own count",
    recruitment.value === formatUnits(6),
  );

  check(
    "...and carries the engine's band: 6 is >= 3, so GREEN",
    recruitment.status === "green" && recruitment.statusLabel === "GREEN",
  );

  const activeHp = metric(detail, "activeHp");

  check(
    // Stage 8 moved the SOURCE of this figure - it is counted from the imported
    // HP rows now rather than keyed in from eTrust - and left everything else
    // about it alone: same tile, same place, same 31 for this HM and month.
    "Active HP is counted from the HP rows, never recalculated from sales",
    activeHp.value === formatUnits(31) &&
      activeHp.note === "HPs with Key-In this month",
    `${activeHp.value} / ${activeHp.note}`,
  );

  check(
    "...and it is given no status band, because the business defined none",
    activeHp.status === null,
  );

  const shi = detail.secondary.find((entry) => entry.key === "shi")!;

  check(
    "SHI is the HM's own eTrust figure",
    shi.value === "78.0%" && shi.note === "From eTrust",
    `got ${shi.value}`,
  );
}

{
  // The recruitment bands: >=3 green, 1-2 yellow, 0 red, blank neutral.
  const roster = createRoster(["Three", "Two", "None"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Three: { monthly: { net: 10, target: 10, recruitment: 3 } },
      Two: { monthly: { net: 10, target: 10, recruitment: 2 } },
      None: { monthly: { net: 10, target: 10, recruitment: 0 } },
    },
  });

  const bands = ["Three", "Two", "None"].map(
    (name) => metric(detailOf(roster, [month], month, name), "recruitment").status,
  );

  check(
    "3 green, 2 yellow, 0 red - the engine's bands, not the screen's",
    bands.join(",") === "green,yellow,red",
    `got ${bands.join(",")}`,
  );
}

{
  const roster = createRoster(["Blank"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {},
  });

  const detail = detailOf(roster, [month], month, "Blank");

  check(
    "an unentered SHI says so - never the group figure, an average or last month",
    detail.secondary.find((entry) => entry.key === "shi")!.value === "—" &&
      detail.secondary.find((entry) => entry.key === "shi")!.note ===
        "Not entered",
  );

  check(
    // Blank, not 0. A month whose HP Excel has not been imported has said
    // nothing about this HM's HPs, and "0 active" would be a claim.
    "a month with no HP data says so, rather than reporting zero active",
    metric(detail, "activeHp").value === "—" &&
      metric(detail, "activeHp").note === "No HP data imported",
    `${metric(detail, "activeHp").value} / ${metric(detail, "activeHp").note}`,
  );

  check(
    "an unentered recruitment is NEUTRAL, not a red zero",
    metric(detail, "recruitment").value === "—" &&
      metric(detail, "recruitment").status === "neutral",
  );
}

// =============================================================================
section("[10] the sales mix");
// =============================================================================

{
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha");
  const mix = detail.salesMix;

  check(
    "Extrade units are the keyed figure",
    mix.extrade.unitsLabel === formatUnits(28),
  );

  check(
    "Extrade % is the ENGINE's share of TOTAL KEY-IN: 28 of 72",
    mix.extrade.percentageLabel === "38.9%",
    `got ${mix.extrade.percentageLabel}`,
  );

  check(
    "Non-Extrade % is the engine's too: 44 of 72 Key-In",
    mix.nonExtrade.unitsLabel === formatUnits(44) &&
      mix.nonExtrade.percentageLabel === "61.1%",
    `got ${mix.nonExtrade.percentageLabel}`,
  );

  check(
    "the bars are drawn to the same shares the labels state",
    close(mix.extrade.barPct, 38.888, 0.01) &&
      close(mix.nonExtrade.barPct, 61.111, 0.01),
  );

  check(
    "a split that happens to come to the Key-In total reads OK",
    mix.isBalanced && mix.balanceLabel === "OK",
  );

  check("...and says what that means in words", mix.balanceNote.length > 0);
}

{
  // The worked example: Key-In 72, Net 65, Extrade 27, Non-Extrade 24. Three
  // independent figures - a perfectly ordinary month that the old Net identity
  // would have refused.
  const roster = createRoster(["Split"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Split: {
        monthly: { net: 65, target: 100, extrade: 27, nonExtrade: 24 },
        weekly: [20, 18, 13, 21, null],
      },
    },
  });

  const mix = detailOf(roster, [month], month, "Split").salesMix;

  check(
    "Extrade 27 of 72 Key-In is 37.5%, NOT 27 of Net 65",
    mix.extrade.percentageLabel === "37.5%",
    `got ${mix.extrade.percentageLabel}`,
  );
  check(
    "Non-Extrade 24 of 72 Key-In is 33.3%",
    mix.nonExtrade.percentageLabel === "33.3%",
    `got ${mix.nonExtrade.percentageLabel}`,
  );
  check(
    "the split is shown as a plain signed difference against Key-In",
    !mix.isBalanced && mix.balanceLabel === "−21",
    `got ${mix.balanceLabel}`,
  );
  check(
    "...described against Key-In, not as a broken rule about Net",
    mix.balanceNote.includes("Key-In") && !mix.balanceNote.includes("Net"),
    mix.balanceNote,
  );
}

{
  const roster = createRoster(["NoSplit"]);
  const month = buildMonthRecords(roster, { year: 2026, month: 9, hms: {} });

  const mix = detailOf(roster, [month], month, "NoSplit").salesMix;

  check(
    "with nothing entered there is no split to show, and no 0.0%",
    !mix.hasSplit &&
      mix.extrade.percentageLabel === "—" &&
      mix.nonExtrade.percentageLabel === "—",
  );

  check(
    "...and the balance is blank rather than a confident zero",
    mix.balanceLabel === "—",
  );
}

// =============================================================================
section("[11] month over month");
// =============================================================================

{
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha");
  const net = detail.previousMonthNet;

  check(
    "September 72 against August 11 is +61",
    net.hasPreviousMonth && net.changeUnitsLabel === "+61",
    `got ${net.changeUnitsLabel}`,
  );

  check(
    "...as a percentage of the previous month",
    net.changePercentageLabel === "+554.5%",
    `got ${net.changePercentageLabel}`,
  );

  check(
    "...naming the month compared against, and both figures",
    net.previousMonthLabel === "August 2026" &&
      net.previousNetLabel === formatUnits(11) &&
      net.currentNetLabel === formatUnits(72),
  );

  check("...and the direction, for a reader who cannot see a colour", net.direction === "up");

  const recruitment = detail.previousMonthRecruitment;

  check(
    "recruitment is compared the same way: 6 against 4 is +2",
    recruitment.hasPreviousMonth && recruitment.changeUnitsLabel === "+2",
    `got ${recruitment.changeUnitsLabel}`,
  );

  check(
    "...with its own percentage, off its own baseline",
    recruitment.changePercentageLabel === "+50.0%",
    `got ${recruitment.changePercentageLabel}`,
  );
}

{
  // Charlie only exists in September, with no record at all.
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Charlie");

  check(
    "an HM with no previous month says so rather than inventing a change",
    !detail.previousMonthNet.hasPreviousMonth &&
      detail.previousMonthNet.emptyMessage === "No previous month data",
  );

  check(
    "...and no percentage is produced from nothing",
    detail.previousMonthNet.changePercentageLabel === "—" &&
      detail.previousMonthNet.direction === "unknown",
  );
}

{
  // A previous month that really was zero: the unit difference is meaningful,
  // the percentage is not.
  const roster = createRoster(["Restart"]);
  const august = buildMonthRecords(roster, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: { Restart: { monthly: { net: 0, target: 40 } } },
  });
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Restart: { monthly: { net: 30, target: 40 } } },
  });

  const net = detailOf(roster, [august, september], september, "Restart")
    .previousMonthNet;

  check(
    "a previous month of 0 keeps its unit difference",
    net.hasPreviousMonth && net.changeUnitsLabel === "+30",
  );

  check(
    "...but shows no percentage - there is no increase from nothing, and never +∞%",
    net.changePercentageLabel === "—",
  );
}

{
  // An HM keyed in for August but not yet for September.
  const roster = createRoster(["Pending"]);
  const august = buildMonthRecords(roster, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: { Pending: { monthly: { net: 50, target: 60, recruitment: 3 } } },
  });
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {},
  });

  const detail = detailOf(roster, [august, september], september, "Pending");

  check(
    "no September record is not a collapse to zero: no change is reported",
    detail.previousMonthNet.changeUnitsLabel === "—" &&
      detail.previousMonthNet.changePercentageLabel === "—",
  );

  check(
    "...and the same holds for recruitment",
    detail.previousMonthRecruitment.changeUnitsLabel === "—",
  );

  check(
    "the August figure is still shown, so the reader sees what there is",
    detail.previousMonthNet.previousNetLabel === formatUnits(50),
  );
}

// =============================================================================
section("[12] quarter to date");
// =============================================================================

{
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha");

  check(
    "QTD Net is July 60 + August 11 + September 72 = 143",
    detail.qtd.netLabel === formatUnits(143),
    `got ${detail.qtd.netLabel}`,
  );

  check(
    "QTD recruitment is 2 + 4 + 6 = 12",
    detail.qtd.recruitmentLabel === formatUnits(12),
    `got ${detail.qtd.recruitmentLabel}`,
  );

  check(
    "the quarter is named",
    detail.qtd.quarterLabel === "Q3 2026",
  );

  check(
    "a complete quarter to date says so and names no gaps",
    detail.qtd.isComplete &&
      detail.qtd.monthsLabel === "3 of 3 months" &&
      detail.qtd.incompleteMessage === null,
  );
}

{
  // Charlie has September only - the other two months of the quarter are gaps,
  // not zeros.
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Charlie");

  check(
    "a month with no record contributes nothing rather than a zero",
    detail.qtd.netLabel === formatUnits(0) && !detail.qtd.isComplete,
  );

  check(
    "...and the missing months are NAMED, never quietly summed over",
    detail.qtd.incompleteMessage ===
      "No data yet: July 2026, August 2026, September 2026",
    `got ${detail.qtd.incompleteMessage}`,
  );
}

{
  // The first month of a quarter: the quarter to date is one month long.
  const roster = createRoster(["Q4"]);
  const october = buildMonthRecords(roster, {
    year: 2026,
    month: 10,
    hms: { Q4: { monthly: { net: 20, target: 40, recruitment: 1 } } },
  });

  const detail = detailOf(roster, [october], october, "Q4");

  check(
    "October opens Q4, so the quarter to date is October alone",
    detail.qtd.quarterLabel === "Q4 2026" &&
      detail.qtd.monthsLabel === "1 of 1 months" &&
      detail.qtd.isComplete,
  );

  check(
    "...and no future month of the quarter is invented",
    detail.qtd.netLabel === formatUnits(20),
  );
}

// =============================================================================
section("[13] an HM with no record for the month");
// =============================================================================

{
  const detail = detailOf(TEAM, MONTHS, SEPTEMBER, "Charlie");

  check(
    "the HM's identity still renders normally",
    detail.hm.name === "Charlie" && detail.hm.office === "Sample Office",
  );

  check(
    "the screen says outright that nothing has been entered",
    detail.hasMonthlyRecord === false &&
      detail.hasAnyData === false &&
      detail.emptyMessage ===
        "No performance data entered for September 2026.",
    `got ${detail.emptyMessage}`,
  );

  const blanks = [
    detail.net.value,
    detail.target.value,
    detail.achievement.value,
    detail.keyIn.value,
    detail.netRatio.value,
    metric(detail, "recruitment").value,
    metric(detail, "activeHp").value,
    detail.secondary.find((entry) => entry.key === "shi")!.value,
  ];

  check(
    "every KPI is blank - not one misleading zero among them",
    blanks.every((value) => value === "—"),
    `got ${blanks.join(", ")}`,
  );

  check(
    "the weekly section is neutral throughout, not a month of red weeks",
    detail.weekly.weeks.every(
      (week) => week.status === "neutral" && week.unitsLabel === "—",
    ) && detail.weekly.hasEntries === false,
  );

  check(
    "no unit is attached to a blank figure - '— units' reads as broken",
    detail.net.unit === null && detail.keyIn.unit === null,
  );
}

{
  // Weekly Key-In entered, no monthly row yet: data exists, so no empty banner.
  const roster = createRoster(["Partial"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Partial: { weekly: [20, 18, null, null, null] } },
  });

  const detail = detailOf(roster, [month], month, "Partial");

  check(
    "weeks keyed in but no monthly row still counts as data on the screen",
    detail.hasAnyData && !detail.hasMonthlyRecord && detail.emptyMessage === null,
  );

  check(
    "...Key-In is the sum of those weeks",
    detail.keyIn.value === formatUnits(38),
  );

  check(
    "...while Net stays blank, because nobody has keyed it",
    detail.net.value === "—",
  );
}

// =============================================================================
section("[14] an HM who has left keeps the months they worked");
// =============================================================================

{
  // "Departed" is inactive today and has a July record only.
  const july = detailOf(TEAM, MONTHS, JULY, "Departed");

  check(
    "their historical month still renders in full",
    july.net.value === formatUnits(25) && july.hasMonthlyRecord,
  );

  check(
    "...and they are badged inactive rather than hidden",
    july.hm.isActive === false,
  );

  check(
    "...and they are still ranked in the month they worked",
    july.hm.rankLabel !== null,
    `got ${july.hm.rankLabel}`,
  );

  const september = detailOf(TEAM, MONTHS, SEPTEMBER, "Departed");

  check(
    "in a month they were not there for, the screen still opens",
    september.hm.name === "Departed" && september.hm.isActive === false,
  );

  check(
    "...saying nothing was entered rather than 404ing on somebody who exists",
    september.emptyMessage ===
      "No performance data entered for September 2026.",
  );

  check(
    "...with no rank, because they are not in that month's ranking",
    september.hm.rankLabel === null,
  );

  check(
    "...and their real July still counts towards the quarter",
    september.qtd.netLabel === formatUnits(25),
    `got ${september.qtd.netLabel}`,
  );
}

// =============================================================================
section("[15] an HM id that names nobody");
// =============================================================================

{
  const bundle = bundleOf(TEAM, MONTHS, SEPTEMBER);

  check(
    "an unknown id builds no model, so the route can say 'HM not found'",
    buildHmPerformanceViewModel(bundle, "00000000-0000-4000-8000-000000000000") ===
      null,
  );

  check(
    "...and so does an id that is not a uuid at all",
    buildHmPerformanceViewModel(bundle, "nonsense") === null,
  );

  const missingMonth: PerformanceBundle = {
    ...bundle,
    selectedMonthId: "00000000-0000-4000-8000-000000000001",
  };

  check(
    "a selected month missing from its own bundle builds nothing, rather than half a screen",
    buildHmPerformanceViewModel(missingMonth, hmId(TEAM, "Alisha")) === null,
  );
}

// =============================================================================
section("[16] the HM screen and the dashboard cannot disagree");
// =============================================================================

/**
 * The source-of-truth test.
 *
 * Same HM, same month, two screens. Every figure they share is compared as the
 * STRING each would render, so this fails if either surface starts formatting,
 * rounding or selecting differently - which is the way two screens actually
 * drift apart, long before anyone changes a formula.
 */
{
  for (const records of [SEPTEMBER, AUGUST, JULY]) {
    const bundle = bundleOf(TEAM, MONTHS, records);

    const dashboard = buildDashboardViewModel({
      selectedMonth: records.month,
      performance: buildMonthlyPerformanceViewModel(bundle)!,
      lastUpdatedAt: null,
    });

    for (const card of dashboard.hms) {
      const detail = buildHmDetailViewModel({
        selectedMonth: records.month,
        model: buildHmPerformanceViewModel(bundle, card.hmId)!,
        lastUpdatedAt: null,
      });

      const same =
        card.netLabel === detail.net.value &&
        card.keyInLabel === detail.keyIn.value &&
        card.targetLabel === detail.target.value &&
        card.achievementLabel === detail.achievement.value &&
        card.recruitmentLabel === metric(detail, "recruitment").value &&
        card.activeHpLabel === metric(detail, "activeHp").value &&
        card.recruitmentStatus === metric(detail, "recruitment").status &&
        card.hasMonthlyRecord === detail.hasMonthlyRecord;

      check(
        `${card.name}, ${records.month.label}: every shared figure is identical on both screens`,
        same,
        `card ${card.netLabel}/${card.keyInLabel}/${card.achievementLabel} vs detail ${detail.net.value}/${detail.keyIn.value}/${detail.achievement.value}`,
      );
    }
  }
}

{
  // And the per-HM comparison the dashboard already held is the one the HM
  // screen shows - read from the month model, not recomputed.
  const bundle = bundleOf(TEAM, MONTHS, SEPTEMBER);
  const monthModel = buildMonthlyPerformanceViewModel(bundle)!;
  const id = hmId(TEAM, "Alisha");
  const model = buildHmPerformanceViewModel(bundle, id)!;

  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);

  check(
    "the HM screen's MoM is the one the month model already built",
    same(model.previousMonthNet, monthModel.hmPreviousMonth[id]),
  );

  check(
    "...and so is the QTD",
    same(model.qtd, monthModel.hmQtd[id]),
  );

  check(
    "...and the performance model itself is the dashboard's own",
    same(
      model.performance,
      monthModel.group.hms.find((hm) => hm.hmId === id),
    ),
  );
}

// =============================================================================
section("[17] switching month replaces every figure");
// =============================================================================

{
  const september = detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha");
  const august = detailOf(TEAM, MONTHS, AUGUST, "Alisha");

  check(
    "September Net is 72 and August Net is 11 - the live acceptance figures",
    september.net.value === formatUnits(72) &&
      august.net.value === formatUnits(11),
  );

  const changed = [
    september.net.value !== august.net.value,
    september.keyIn.value !== august.keyIn.value,
    september.achievement.value !== august.achievement.value,
    september.netRatio.value !== august.netRatio.value,
    metric(september, "recruitment").value !== metric(august, "recruitment").value,
    metric(september, "activeHp").value !== metric(august, "activeHp").value,
    september.secondary.find((e) => e.key === "shi")!.value !==
      august.secondary.find((e) => e.key === "shi")!.value,
    september.weekly.totalLabel !== august.weekly.totalLabel,
    september.previousMonthNet.previousMonthLabel !==
      august.previousMonthNet.previousMonthLabel,
    september.qtd.netLabel !== august.qtd.netLabel,
    september.month.label !== august.month.label,
    september.backHref !== august.backHref,
  ];

  check(
    "every section moves with the month - nothing is carried over stale",
    changed.every(Boolean),
    `unchanged at index ${changed.findIndex((entry) => !entry)}`,
  );

  check(
    "the weekly calendar itself changes: five September periods, four August ones",
    september.weekly.weeksConfigured === SEPTEMBER_WEEKS.length &&
      august.weekly.weeksConfigured === FOUR_WEEKS.length,
  );

  check(
    "August's comparison is against July, not against September",
    august.previousMonthNet.previousMonthLabel === "July 2026" &&
      august.previousMonthNet.previousNetLabel === formatUnits(60),
  );

  check(
    "August's quarter to date stops at August: 60 + 11 = 71",
    august.qtd.netLabel === formatUnits(71) &&
      august.qtd.monthsLabel === "2 of 2 months",
    `got ${august.qtd.netLabel}`,
  );
}

// =============================================================================
section("[18] the recruitment comparison model (Stage 3 extension)");
// =============================================================================

/**
 * The one calculation this stage added, tested where it lives.
 *
 * Only the rules that are NEW here: everything else about a month-over-month
 * comparison is already proved in `stage3.test.mts` against the Net version,
 * which now runs through this same function.
 */
{
  const month = { year: 2026, month: 8 };

  const up = calculateMetricMonthComparison(6, { value: 4, month });

  check(
    "6 against 4 is +2, and +50%",
    up.differenceUnits === 2 && close(up.percentageChange, 50),
  );

  const fromZero = calculateMetricMonthComparison(3, { value: 0, month });

  check(
    "a baseline of 0 keeps the difference and drops the percentage",
    fromZero.differenceUnits === 3 && fromZero.percentageChange === null,
  );

  const absent = calculateMetricMonthComparison(3, null);

  check(
    "no previous month means no comparison, in either direction",
    !absent.hasPreviousMonthData &&
      absent.differenceUnits === null &&
      absent.percentageChange === null,
  );

  const noCurrent = calculateMetricMonthComparison(
    0,
    { value: 4, month },
    { hasCurrentData: false },
  );

  check(
    "no CURRENT record is not a fall to zero: the previous figure is kept, the change is not",
    noCurrent.previousValue === 4 &&
      noCurrent.differenceUnits === null &&
      noCurrent.percentageChange === null,
  );

  const down = calculateMetricMonthComparison(2, { value: 8, month });

  check(
    "a decrease is negative, and never rendered as Infinity or NaN",
    down.differenceUnits === -6 &&
      close(down.percentageChange, -75) &&
      Number.isFinite(down.percentageChange!),
  );
}

// =============================================================================
section("[19] nothing on the HM screen is NaN, Infinity or a stray sentinel");
// =============================================================================

{
  const scenarios: [string, HmDetailViewModel][] = [
    ["a full month", detailOf(TEAM, MONTHS, SEPTEMBER, "Alisha")],
    ["an HM with no record", detailOf(TEAM, MONTHS, SEPTEMBER, "Charlie")],
    ["an HM who has left", detailOf(TEAM, MONTHS, SEPTEMBER, "Departed")],
    ["a historical month", detailOf(TEAM, MONTHS, JULY, "Alisha")],
  ];

  for (const [name, detail] of scenarios) {
    const serialized = JSON.stringify(detail);

    check(
      `${name}: no NaN, Infinity, undefined or null leaks into a label`,
      !/NaN|Infinity|"undefined"|"null"|"-1"/.test(serialized),
      serialized.slice(0, 200),
    );

    const numbers: number[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "number") {
        numbers.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(walk);
      }
    };
    walk(detail);

    check(
      `${name}: every number in the model is finite`,
      numbers.every((entry) => Number.isFinite(entry)),
    );
  }
}

// =============================================================================
section("[20] the layout contract the HM screen is built to");
// =============================================================================

/**
 * Structural checks on the components themselves.
 *
 * A stylesheet cannot be exercised in Node, so what is guarded here is the
 * handful of layout decisions that would be a real regression if somebody
 * removed them - and, for this stage, the mobile ones especially.
 */
{
  const page = read("app/(app)/hm/[hmId]/page.tsx");

  check(
    "the screen reads both the HM and the month from the URL, so a refresh keeps them",
    page.includes("props.params") &&
      page.includes("searchParams") &&
      page.includes("parseMonthParam"),
  );

  check(
    "it is guarded like every other authenticated page - no public HM view",
    page.includes("requirePaOrManager"),
  );

  check(
    "the weekly section and the sales mix share a row only from lg up",
    page.includes("lg:grid-cols-3") && page.includes("lg:col-span-2"),
  );

  check(
    "the comparison and the quarter sit side by side from md up",
    page.includes("md:grid-cols-2"),
  );

  const primary = read("components/hm-detail/hm-primary-performance.tsx");

  check(
    "Net, Target and Achievement stack on a phone and share a row from sm",
    primary.includes("sm:grid-cols-3"),
  );

  check(
    "Net is set larger than everything supporting it",
    primary.includes('emphasis="hero"'),
  );

  const secondary = read("components/hm-detail/hm-secondary-kpis.tsx");

  check(
    "the three keyed figures are two columns on a phone, three from sm",
    secondary.includes("grid-cols-2") && secondary.includes("sm:grid-cols-3"),
  );

  const weekly = read("components/hm-detail/hm-weekly-performance.tsx");

  check(
    "the weekly bars run across, so the Coway dates survive a 375px screen",
    weekly.includes("space-y-2.5") && !weekly.includes("items-end gap-2"),
  );

  const header = read("components/hm-detail/hm-detail-header.tsx");

  check(
    "back is a real link, at a comfortable tap size",
    header.includes("min-h-11") && header.includes("Back to Dashboard"),
  );

  check(
    "the HM's name wraps rather than being truncated",
    header.includes("break-words") &&
      // Comments stripped first: the file EXPLAINS that it does not truncate.
      !/truncate/.test(header.replace(/\/\*[\s\S]*?\*\//g, "")),
  );

  const clientComponents = ["components/dashboard/month-switcher.tsx"];

  check(
    "the month switcher is the only client component the screen uses",
    clientComponents.every((file) => read(file).startsWith('"use client"')),
  );

  const serverComponents = [
    "app/(app)/hm/[hmId]/page.tsx",
    "components/hm-detail/hm-detail-header.tsx",
    "components/hm-detail/hm-primary-performance.tsx",
    "components/hm-detail/hm-secondary-kpis.tsx",
    "components/hm-detail/hm-weekly-performance.tsx",
    "components/hm-detail/hm-sales-mix.tsx",
    "components/hm-detail/hm-comparison.tsx",
    "components/hm-detail/hm-qtd.tsx",
    "components/hm-detail/hm-metric.tsx",
    "components/hm-detail/hm-detail-states.tsx",
    "components/hm-detail/hm-detail-skeleton.tsx",
  ];

  check(
    "everything else renders on the server, shipping no JavaScript",
    serverComponents.every((file) => !read(file).includes('"use client"')),
  );

  check(
    "the screen has its own loading state, not the dashboard's",
    read("app/(app)/hm/[hmId]/loading.tsx").includes(
      "HmDetailSkeleton",
    ),
  );

  check(
    "...and its own error boundary, which never prints the raw error",
    read("app/(app)/hm/[hmId]/error.tsx").includes('"use client"') &&
      read("app/(app)/hm/[hmId]/error.tsx").includes("retry") &&
      !read("app/(app)/hm/[hmId]/error.tsx").includes("{error.message}"),
  );

  const card = read("components/dashboard/hm-card.tsx");

  check(
    "the dashboard card is a link, with accessible semantics rather than an onClick",
    card.includes("<Link") && card.includes("hm.href") && !card.includes("onClick"),
  );

  check(
    "...and it stays a Server Component",
    !card.includes('"use client"'),
  );
}

// =============================================================================
section("[21] no HM detail component recomputes a business figure");
// =============================================================================

/**
 * The Stage 4 rule, extended to Stage 5 and enforced rather than remembered.
 *
 * Components receive presenter models made of strings and statuses. If one of
 * them reaches for a raw engine field - `netUnits`, `achievementPct`,
 * `extradeUnits` - it is about to do arithmetic that already has a definition
 * somewhere else, which is the one thing this stage is not allowed to do.
 */
{
  const files = [
    "app/(app)/hm/[hmId]/page.tsx",
    "components/hm-detail/hm-detail-header.tsx",
    "components/hm-detail/hm-primary-performance.tsx",
    "components/hm-detail/hm-secondary-kpis.tsx",
    "components/hm-detail/hm-weekly-performance.tsx",
    "components/hm-detail/hm-sales-mix.tsx",
    "components/hm-detail/hm-comparison.tsx",
    "components/hm-detail/hm-qtd.tsx",
    "components/hm-detail/hm-metric.tsx",
    "components/hm-detail/hm-detail-states.tsx",
  ];

  const rawFields = [
    "netUnits",
    "totalKeyIn",
    "targetNetUnits",
    "achievementPct",
    "netRatioPct",
    "extradeUnits",
    "nonExtradeUnits",
    "extradePct",
    "nonExtradePct",
    "splitBalance",
    "shiPct",
    "activeHp",
    "keyInUnits",
    "weeklyPerformance",
  ];

  const offenders: string[] = [];

  for (const file of files) {
    const source = read(file);

    for (const field of rawFields) {
      if (source.includes(`.${field}`)) {
        offenders.push(`${file} -> ${field}`);
      }
    }
  }

  check(
    "no component touches a raw calculated field - they read presenter labels",
    offenders.length === 0,
    offenders.join("\n        "),
  );

  // The arithmetic that would be a formula in disguise.
  const operators = [
    /\/\s*(?:hm|detail|week|entry|metric)\./,
    /\*\s*100\b/,
    /\breduce\(/,
    />\s*15\b/,
    />=\s*3\b/,
  ];

  const arithmetic: string[] = [];

  for (const file of files) {
    const source = read(file);

    for (const pattern of operators) {
      if (pattern.test(source)) {
        arithmetic.push(`${file} -> ${pattern}`);
      }
    }
  }

  check(
    "and none of them divides, sums or compares against a threshold",
    arithmetic.length === 0,
    arithmetic.join("\n        "),
  );

  const calculationImports = files.filter((file) => {
    const source = read(file);

    if (!source.includes("@/lib/calculations")) {
      return false;
    }

    // The one allowed import: the locked weekly thresholds, so the legend
    // states the same numbers the engine bands with instead of retyping them.
    return !(
      source.includes("WEEKLY_KEYIN_GREEN_ABOVE") &&
      source.includes("WEEKLY_KEYIN_YELLOW_FROM")
    );
  });

  check(
    "and none of them import the calculation engine to do sums with",
    calculationImports.length === 0,
    calculationImports.join(", "),
  );

  const presenter = read("lib/view-models/hm-detail.ts");

  check(
    "the presenter formats with the engine's own helpers",
    presenter.includes("formatPercentage") &&
      presenter.includes("formatUnits") &&
      presenter.includes('from "@/lib/calculations"'),
  );

  check(
    "...and reuses the dashboard's builders where the figure is the same one",
    presenter.includes("buildMonthOverMonthModel") &&
      presenter.includes("buildQtdModel"),
  );
}

// =============================================================================
section("[22] the HM screen's fetch stays batched");
// =============================================================================

{
  const source = read("lib/data/hm-detail.ts");

  const selects = source.match(/\.from\(/g) ?? [];

  check(
    "it issues no query of its own - it reads the dashboard's batched bundle",
    selects.length === 0,
    `found ${selects.length}`,
  );

  check(
    "...which is what makes the two screens' figures the same by construction",
    source.includes("getDashboardData"),
  );

  check(
    "the HM is identified from the roster already fetched, not by a second query",
    source.includes("bundle.hms.find"),
  );

  check(
    "it never reaches for the service-role client",
    !source.includes("admin"),
  );

  check(
    "and it is server-only, so RLS applies as the signed-in user",
    source.includes('import "server-only"'),
  );

  // Still a FIXED number of queries, whatever the position in the quarter.
  // Stage 8 added one - the database-side Active HP count - and it is `in` the
  // wanted months like every other, so the count does not grow with the roster,
  // the quarter or the HP list.
  const dashboardSource = read("lib/data/dashboard.ts");

  check(
    "the shared fetch is still a fixed seven queries, whatever the position in the quarter",
    (dashboardSource.match(/\.from\(/g) ?? []).length === 7,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
