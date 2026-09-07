/**
 * Stage 4 tests: the dashboard.
 *
 *   npm run test:stage4
 *
 * Same shape as Stages 1-3 - plain Node, no framework, one file, the Stage 3
 * fixtures reused so a scenario is a spec rather than a page of literal rows.
 *
 * ---------------------------------------------------------------------------
 * What is being tested, and what deliberately is not
 * ---------------------------------------------------------------------------
 * NOT the formulas. Achievement, Net Ratio, the totals, the ranking, the status
 * bands, MoM and QTD are proved in `stage3.test.mts` against the engine. A
 * dashboard test that re-divided Net by Target would only prove the test can
 * divide, and would go green if both it and the engine were wrong the same way.
 *
 * What IS tested is the join between the two: that the tile labelled
 * Achievement carries the ENGINE's achievement, that the HM cards come out in
 * the ENGINE's ranked order, that a blank week reaches the chart as blank
 * rather than as a zero, and that every "no data" case reads as missing rather
 * than as bad.
 *
 * The presenter is the seam that makes this possible without a DOM: components
 * receive already-formatted strings and lay them out, so asserting on the
 * presenter's output is asserting on what renders.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  calculateGroupWeeklyKeyIn,
  formatPercentage,
  formatSignedPercentage,
  formatSignedUnits,
  formatUnits,
  toSalesWeekInput,
  weeklyKeyInStatus,
  WEEKLY_KEYIN_GREEN_ABOVE,
  WEEKLY_KEYIN_YELLOW_FROM,
} from "@/lib/calculations";
import {
  formatUpdatedAt,
  monthParam,
  parseMonthParam,
  resolveDashboardMonth,
} from "@/lib/calendar";
import {
  buildDashboardViewModel,
  type DashboardViewModel,
  type KpiKey,
} from "@/lib/view-models/dashboard";
import {
  buildMonthlyPerformanceViewModel,
  type MonthPerformanceRecords,
  type PerformanceBundle,
} from "@/lib/view-models/monthly-performance";
import {
  FOUR_WEEKS,
  buildMonth,
  buildMonthRecords,
  createRoster,
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

/** A whole dashboard from a set of month records, exactly as the page builds it. */
function dashboardOf(
  roster: Roster,
  months: MonthPerformanceRecords[],
  selected: MonthPerformanceRecords,
  {
    groupShiPct = null,
    lastUpdatedAt = null,
  }: { groupShiPct?: number | null; lastUpdatedAt?: string | null } = {},
): DashboardViewModel {
  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(roster, months, selected, groupShiPct),
  );

  if (!performance) {
    throw new Error("Fixture error: the view model could not be built.");
  }

  return buildDashboardViewModel({
    selectedMonth: selected.month,
    performance,
    lastUpdatedAt,
  });
}

function kpi(dashboard: DashboardViewModel, key: KpiKey) {
  const tile = dashboard.kpis.find((entry) => entry.key === key);

  if (!tile) {
    throw new Error(`No KPI tile for "${key}".`);
  }

  return tile;
}

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

function read(relative: string): string {
  return readFileSync(path.join(SRC, relative), "utf8");
}

// =============================================================================
section("[1] the reporting month resolves from the clock, never from a constant");
// =============================================================================

{
  const september = buildMonth(2026, 9);
  const august = buildMonth(2026, 8);
  const july = buildMonth(2026, 7);
  const months = [september, august, july];

  const onTheFourth = new Date("2026-09-04T09:00:00Z");

  const current = resolveDashboardMonth(months, null, { today: onTheFourth });

  check(
    "with no month asked for, today's reporting month is selected",
    current.month?.id === september.id && current.source === "current",
  );

  check(
    "and it reports that the current month exists",
    current.currentMonthExists &&
      current.currentYearMonth.year === 2026 &&
      current.currentYearMonth.month === 9,
  );

  const inOctober = resolveDashboardMonth(months, null, {
    today: new Date("2026-10-02T09:00:00Z"),
  });

  check(
    "in a month nobody has opened, the latest month is shown as a FALLBACK",
    inOctober.month?.id === september.id && inOctober.source === "fallback",
  );

  check(
    "and the missing current month is flagged, so the page can say so",
    inOctober.currentMonthExists === false &&
      inOctober.currentYearMonth.month === 10,
  );

  const requested = resolveDashboardMonth(
    months,
    { kind: "yearMonth", year: 2026, month: 7 },
    { today: onTheFourth },
  );

  check(
    "an explicit ?month wins over today's month",
    requested.month?.id === july.id && requested.source === "requested",
  );

  const byId = resolveDashboardMonth(
    months,
    { kind: "id", id: august.id },
    { today: onTheFourth },
  );

  check(
    "a month id is accepted too, so a Data Entry link does not dead-end",
    byId.month?.id === august.id && byId.source === "requested",
  );

  const missing = resolveDashboardMonth(
    months,
    { kind: "yearMonth", year: 2025, month: 3 },
    { today: onTheFourth },
  );

  check(
    "a month that does not exist falls back and is reported as invalid",
    missing.month?.id === september.id && missing.source === "invalid",
  );

  const malformed = resolveDashboardMonth(months, null, {
    today: onTheFourth,
    requestWasMalformed: true,
  });

  check(
    "a malformed ?month is also reported, never silently ignored",
    malformed.source === "invalid" && malformed.month?.id === september.id,
  );

  const none = resolveDashboardMonth([], null, { today: onTheFourth });

  check(
    "with no reporting months at all there is nothing to select",
    none.month === null && none.currentMonthExists === false,
  );

  // The one thing this must never do: report a fallback as if it were current.
  check(
    "a fallback is never labelled 'current'",
    inOctober.source !== "current",
  );
}

// =============================================================================
section("[2] the month in the URL");
// =============================================================================

{
  check(
    "?month=2026-09 parses to September 2026",
    JSON.stringify(parseMonthParam("2026-09")) ===
      JSON.stringify({ kind: "yearMonth", year: 2026, month: 9 }),
  );

  check(
    "a uuid parses as a month id",
    parseMonthParam("2f1c8a3e-4b5d-4c6e-8f90-1a2b3c4d5e6f")?.kind === "id",
  );

  const rejected = [
    "2026-13",
    "2026-00",
    "1999-09",
    "september",
    "2026/09",
    "2026-9",
    "",
    "  ",
    "'; drop table months; --",
  ];

  check(
    "everything malformed is rejected rather than guessed at",
    rejected.every((value) => parseMonthParam(value) === null),
    `unexpectedly accepted: ${rejected.filter((v) => parseMonthParam(v) !== null).join(", ")}`,
  );

  check(
    "an absent parameter is null, not an error",
    parseMonthParam(undefined) === null && parseMonthParam(null) === null,
  );

  const september = buildMonth(2026, 9);

  check(
    "the URL value round-trips: month -> param -> month",
    monthParam(september) === "2026-09" &&
      resolveDashboardMonth([september], parseMonthParam(monthParam(september)))
        .month?.id === september.id,
  );

  check(
    "single-digit months are padded, so links sort and compare",
    monthParam(buildMonth(2027, 1)) === "2027-01",
  );
}

// =============================================================================
section("[3] the group KPI cards carry the engine's figures");
// =============================================================================

const TEAM = createRoster(["Alpha", "Bravo", "Charlie", "Delta"]);

/**
 * A realistic part-entered September: four HMs, five Coway weeks, the last two
 * of them still to come.
 */
const SEPTEMBER = buildMonthRecords(TEAM, {
  year: 2026,
  month: 9,
  hms: {
    Alpha: {
      monthly: { net: 76, target: 100, recruitment: 6, activeHp: 31, shi: 70 },
      weekly: [20, 18, 22, null, null],
    },
    Bravo: {
      monthly: { net: 54, target: 80, recruitment: 2, activeHp: 24, shi: 61 },
      weekly: [14, 12, 16, null, null],
    },
    Charlie: {
      monthly: { net: 91, target: 90, recruitment: 4, activeHp: 40, shi: 77 },
      weekly: [30, 28, 25, null, null],
    },
    Delta: {
      monthly: { net: 49, target: 70, recruitment: 0, activeHp: 19, shi: 55 },
      weekly: [9, 11, 8, null, null],
    },
  },
});

const AUGUST = buildMonthRecords(TEAM, {
  year: 2026,
  month: 8,
  weeks: FOUR_WEEKS,
  hms: {
    Alpha: { monthly: { net: 70, target: 100 }, weekly: [18, 17, 19, 16] },
    Bravo: { monthly: { net: 60, target: 80 }, weekly: [15, 15, 15, 15] },
    Charlie: { monthly: { net: 80, target: 90 }, weekly: [20, 20, 20, 20] },
    Delta: { monthly: { net: 40, target: 70 }, weekly: [10, 10, 10, 10] },
  },
});

const JULY = buildMonthRecords(TEAM, {
  year: 2026,
  month: 7,
  weeks: FOUR_WEEKS,
  hms: {
    Alpha: { monthly: { net: 65, target: 100, recruitment: 3 } },
    Bravo: { monthly: { net: 55, target: 80, recruitment: 1 } },
    Charlie: { monthly: { net: 75, target: 90, recruitment: 2 } },
    Delta: { monthly: { net: 35, target: 70, recruitment: 0 } },
  },
});

{
  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [JULY, AUGUST, SEPTEMBER], SEPTEMBER, 72),
  )!;

  const dashboard = buildDashboardViewModel({
    selectedMonth: SEPTEMBER.month,
    performance,
    lastUpdatedAt: "2026-09-04T06:32:00Z",
  });

  const { group } = performance;

  check(
    "all eight required KPIs are present, in the specified order",
    dashboard.kpis.map((tile) => tile.key).join(",") ===
      "keyIn,net,target,achievement,recruitment,activeHp,netRatio,shi",
  );

  check(
    "Key-In renders the engine's derived total, not a stored field",
    kpi(dashboard, "keyIn").value === formatUnits(group.totalKeyIn) &&
      group.totalKeyIn === 213,
    `tile ${kpi(dashboard, "keyIn").value}, engine ${group.totalKeyIn}`,
  );

  check(
    "Net renders the engine's total",
    kpi(dashboard, "net").value === formatUnits(group.totalNet) &&
      group.totalNet === 270,
  );

  check(
    "Target renders the engine's total",
    kpi(dashboard, "target").value === formatUnits(group.totalTarget) &&
      group.totalTarget === 340,
  );

  check(
    "Achievement renders the engine's group achievement",
    kpi(dashboard, "achievement").value ===
      formatPercentage(group.groupAchievementPct),
  );

  check(
    "Recruitment renders the engine's total",
    kpi(dashboard, "recruitment").value ===
      formatUnits(group.totalRecruitment) && group.totalRecruitment === 12,
  );

  check(
    "Active HP renders the engine's total",
    kpi(dashboard, "activeHp").value === formatUnits(group.totalActiveHp) &&
      group.totalActiveHp === 114,
  );

  check(
    "Net Ratio renders the engine's group ratio",
    kpi(dashboard, "netRatio").value ===
      formatPercentage(group.groupNetRatioPct),
  );

  check(
    "Group SHI renders the eTrust figure that was passed in",
    kpi(dashboard, "shi").value === "72.0%" && group.groupShiPct === 72,
  );

  // The rule this guards: group SHI is keyed in, never derived. The four HM SHI
  // figures average to 65.75, which must not be what appears on the card.
  check(
    "Group SHI is NOT the average of the HM SHI column",
    kpi(dashboard, "shi").value !== formatPercentage(65.75),
  );

  check(
    "the target track shows Net, Target and Achievement together",
    dashboard.target.netLabel === "270" &&
      dashboard.target.targetLabel === "340" &&
      dashboard.target.achievementLabel ===
        formatPercentage(group.groupAchievementPct) &&
      dashboard.target.hasTarget,
  );

  check(
    "the progress bar is the achievement, clamped to the track",
    dashboard.target.progressPct !== null &&
      Math.abs(dashboard.target.progressPct - group.groupAchievementPct!) < 1e-9,
  );

  check(
    "the month, its quarter and its URL parameter are all on the model",
    dashboard.month.label === "September 2026" &&
      dashboard.month.quarterLabel === "Q3 2026" &&
      dashboard.month.param === "2026-09",
  );

  check(
    "the Updated stamp is the data's own timestamp, formatted for MYT",
    dashboard.updatedLabel === formatUpdatedAt("2026-09-04T06:32:00Z") &&
      dashboard.updatedLabel === "4 Sept 2026, 14:32",
    `got ${dashboard.updatedLabel}`,
  );

  check(
    "a month nothing has been written to has no Updated stamp at all",
    dashboardOf(TEAM, [SEPTEMBER], SEPTEMBER).updatedLabel === null,
  );
}

// =============================================================================
section("[4] achievement over 100% is reported honestly");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 118, target: 100 }, weekly: [118] } },
  });

  const dashboard = dashboardOf(roster, [month], month);

  check(
    "the label shows the real figure, past 100%",
    dashboard.target.achievementLabel === "118.0%",
  );

  check(
    "the bar is clamped so it cannot overflow its track",
    dashboard.target.progressPct === 100,
  );
}

// =============================================================================
section("[5] the weekly chart is driven by the Coway calendar");
// =============================================================================

{
  const dashboard = dashboardOf(TEAM, [SEPTEMBER], SEPTEMBER);
  const { weekly } = dashboard;

  check(
    "one bar per configured week - five here, not four",
    weekly.weeks.length === 5 && weekly.weeksConfigured === 5,
  );

  check(
    "labels come from the sales calendar",
    weekly.weeks.map((week) => week.label).join(",") === "W1,W2,W3,W4,W5",
  );

  check(
    "the period is the official one, including a W1 that opens in August",
    weekly.weeks[0]!.rangeLabel === "30 Aug – 5 Sep" &&
      weekly.weeks[4]!.rangeLabel === "27 Sep – 30 Sep",
    weekly.weeks[0]!.rangeLabel,
  );

  // Built independently from the engine, so this is the aggregation being
  // checked rather than the presenter agreeing with itself.
  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [SEPTEMBER], SEPTEMBER),
  )!;

  const fromEngine = calculateGroupWeeklyKeyIn(
    performance.group.hms,
    SEPTEMBER.weeks.map(toSalesWeekInput),
  );

  check(
    "the group weekly totals are the engine's, HM by HM summed",
    weekly.weeks[0]!.units === 73 &&
      weekly.weeks[1]!.units === 69 &&
      weekly.weeks[2]!.units === 71 &&
      weekly.weeks.every(
        (week, index) =>
          week.units ===
          (fromEngine[index]!.isEntered ? fromEngine[index]!.keyInUnits : null),
      ),
  );

  check(
    "weeks nobody has entered are blank, not zero",
    weekly.weeks[3]!.units === null &&
      weekly.weeks[3]!.unitsLabel === "—" &&
      weekly.weeks[4]!.isEntered === false,
  );

  check(
    "a blank future week is NEUTRAL, never red",
    weekly.weeks[3]!.status === "neutral" &&
      weekly.weeks[4]!.status === "neutral",
  );

  check(
    "a blank week has no bar height to draw",
    weekly.weeks[3]!.barPct === 0 && weekly.weeks[4]!.barPct === 0,
  );

  check(
    "how much of the month has been keyed in is reported",
    weekly.weeksEntered === 3 && weekly.hasEntries && weekly.hasWeeks,
  );

  check(
    "the chart total matches the Key-In KPI",
    weekly.totalLabel === kpi(dashboard, "keyIn").value,
  );

  check(
    "each bar knows how many HMs contributed to it",
    weekly.weeks[0]!.hmsEntered === 4 && weekly.weeks[3]!.hmsEntered === 0,
  );

  // The tallest ENTERED week sets the scale; the blank weeks must not.
  const tallest = weekly.weeks.find((week) => week.units === 73)!;

  check(
    "the tallest entered week fills the chart",
    Math.abs(tallest.barPct - 100) < 1e-9,
  );
}

// =============================================================================
section("[6] weekly status uses the locked bands, applied by the engine");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);

  // One HM, so the group weekly total IS the figure the band applies to and the
  // boundaries can be checked exactly: 16 green, 15 yellow, 10 yellow, 9 red.
  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { weekly: [16, 15, 10, 9, null] } },
  });

  const weeks = dashboardOf(roster, [month], month).weekly.weeks;

  check(
    "16 is green - above the threshold",
    weeks[0]!.status === "green" && WEEKLY_KEYIN_GREEN_ABOVE === 15,
  );

  check("15 is YELLOW, not green", weeks[1]!.status === "yellow");

  check(
    "10 is yellow - the bottom of the band",
    weeks[2]!.status === "yellow" && WEEKLY_KEYIN_YELLOW_FROM === 10,
  );

  check("9 is red", weeks[3]!.status === "red");

  check("blank is neutral", weeks[4]!.status === "neutral");

  check(
    "the status shown is the one the central band function returns",
    weeks
      .slice(0, 4)
      .every((week) => week.status === weeklyKeyInStatus(week.units)),
  );

  const zeroWeekMonth = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { weekly: [0] } },
  });

  const zeroWeek = dashboardOf(roster, [zeroWeekMonth], zeroWeekMonth).weekly
    .weeks[0]!;

  check(
    "an entered ZERO week is red, because zero was actually keyed in",
    zeroWeek.status === "red" &&
      zeroWeek.isEntered &&
      zeroWeek.unitsLabel === "0",
  );
}

// =============================================================================
section("[7] W5 and W6 months, and a month with no calendar at all");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);

  const SIX_WEEKS = [
    ["2026-11-29", "2026-12-05"],
    ["2026-12-06", "2026-12-12"],
    ["2026-12-13", "2026-12-19"],
    ["2026-12-20", "2026-12-26"],
    ["2026-12-27", "2026-12-31"],
    ["2027-01-01", "2027-01-02"],
  ] as const;

  const december = buildMonthRecords(roster, {
    year: 2026,
    month: 12,
    weeks: SIX_WEEKS,
    hms: { Alpha: { weekly: [20, 18, 22, 19, 12, 4] } },
  });

  const six = dashboardOf(roster, [december], december).weekly;

  check(
    "six weeks render as six bars",
    six.weeks.length === 6 &&
      six.weeks.map((week) => week.label).join(",") === "W1,W2,W3,W4,W5,W6",
  );

  check(
    "a W6 that runs into January keeps its real dates",
    six.weeks[5]!.rangeLabel === "1 Jan – 2 Jan",
    six.weeks[5]!.rangeLabel,
  );

  const noWeeks = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: [],
    hms: { Alpha: { monthly: { net: 10, target: 20 } } },
  });

  const empty = dashboardOf(roster, [noWeeks], noWeeks).weekly;

  check(
    "a month with no configured calendar says so rather than charting nothing",
    empty.hasWeeks === false && empty.weeks.length === 0,
  );

  check(
    "and its Key-In total is blank, not a zero",
    empty.totalLabel === "—" &&
      kpi(dashboardOf(roster, [noWeeks], noWeeks), "keyIn").value === "—",
  );
}

// =============================================================================
section("[8] HM cards, in the engine's ranked order");
// =============================================================================

{
  const dashboard = dashboardOf(TEAM, [SEPTEMBER], SEPTEMBER);
  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [SEPTEMBER], SEPTEMBER),
  )!;

  check(
    "cards are Net descending: Charlie 91, Alpha 76, Bravo 54, Delta 49",
    dashboard.hms.map((hm) => hm.name).join(",") ===
      "Charlie,Alpha,Bravo,Delta",
  );

  check(
    "the order is the ranking's, entry for entry",
    dashboard.hms.map((hm) => hm.hmId).join(",") ===
      performance.rankings.map((entry) => entry.performance.hmId).join(","),
  );

  check(
    "ranks are carried through, 1-based",
    dashboard.hms.map((hm) => hm.rank).join(",") === "1,2,3,4",
  );

  const alpha = dashboard.hms.find((hm) => hm.name === "Alpha")!;
  const alphaModel = performance.group.hms.find((hm) => hm.hmName === "Alpha")!;

  check(
    "a card carries the required headline figures and nothing invented",
    alpha.netLabel === "76" &&
      alpha.keyInLabel === "60" &&
      alpha.recruitmentLabel === "6" &&
      alpha.activeHpLabel === "31" &&
      alpha.office === "Sample Office",
  );

  check(
    "the card's Key-In is the engine's derived total for that HM",
    alpha.keyInLabel === formatUnits(alphaModel.totalKeyIn),
  );

  check(
    "the card's achievement is the engine's, not a card-level division",
    alpha.achievementLabel === formatPercentage(alphaModel.achievementPct) &&
      alpha.targetLabel === "100",
  );

  check(
    "recruitment status comes from the engine's band: 6 is green",
    alpha.recruitmentStatus === "green" && alphaModel.recruitmentStatus === "green",
  );

  const bravo = dashboard.hms.find((hm) => hm.name === "Bravo")!;
  const delta = dashboard.hms.find((hm) => hm.name === "Delta")!;

  check(
    "2 recruits is yellow, 0 is red - the locked recruitment band",
    bravo.recruitmentStatus === "yellow" && delta.recruitmentStatus === "red",
  );

  check(
    "the photo and its fallback are the HM model's own",
    dashboard.hms.every((hm) => hm.photoUrl === null),
  );
}

// =============================================================================
section("[9] an HM nobody has keyed in is missing, not zero");
// =============================================================================

{
  const roster = createRoster(["Alpha", "Bravo"]);

  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 40, target: 50, recruitment: 3, activeHp: 12 } },
      // Bravo: no monthly row at all.
    },
  });

  const dashboard = dashboardOf(roster, [month], month);
  const bravo = dashboard.hms.find((hm) => hm.name === "Bravo")!;

  check(
    "every figure on the card reads as blank",
    bravo.netLabel === "—" &&
      bravo.keyInLabel === "—" &&
      bravo.recruitmentLabel === "—" &&
      bravo.activeHpLabel === "—" &&
      bravo.targetLabel === "—" &&
      bravo.achievementLabel === "—",
  );

  check(
    "the card is flagged as having no monthly record",
    bravo.hasMonthlyRecord === false && bravo.hasTarget === false,
  );

  check(
    "an un-keyed HM has no recruitment status colour",
    bravo.recruitmentStatus === "neutral",
  );

  check(
    "and they sort last, below the HM who has figures",
    dashboard.hms[0]!.name === "Alpha" && dashboard.hms[1]!.name === "Bravo",
  );
}

// =============================================================================
section("[10] data completeness is visible, and counts rather than judges");
// =============================================================================

{
  const roster = createRoster(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);

  const partial = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 40 } },
      Bravo: { monthly: { net: 30 } },
      Charlie: { monthly: { net: 20 } },
      Delta: { monthly: { net: 10 } },
    },
  });

  const { completeness } = dashboardOf(roster, [partial], partial);

  check(
    "a part-entered month says exactly how much of it is entered",
    completeness.headline === "4 of 6 HMs updated" &&
      completeness.hmRecordsPresent === 4 &&
      completeness.activeHmCount === 6,
  );

  check("and is flagged as partial, not complete", completeness.level === "partial");

  check(
    "the outstanding HMs are named",
    completeness.detail === "Nothing entered yet: Echo, Foxtrot",
    completeness.detail ?? "null",
  );

  const complete = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: Object.fromEntries(
      ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map((name) => [
        name,
        { monthly: { net: 10 } },
      ]),
    ),
  });

  const full = dashboardOf(roster, [complete], complete).completeness;

  check(
    "a fully entered month says so, with no outstanding names",
    full.level === "complete" &&
      full.headline === "All 6 HMs updated" &&
      full.detail === null,
  );

  check(
    "the status is a band the UI already knows how to colour",
    full.status === "green" && completeness.status === "yellow",
  );
}

// =============================================================================
section("[11] the empty and no-data states");
// =============================================================================

{
  const roster = createRoster(["Alpha", "Bravo"]);

  const openedButEmpty = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {},
  });

  const dashboard = dashboardOf(roster, [openedButEmpty], openedButEmpty);

  check(
    "a month nobody has touched reports NO data, so the page can say so",
    dashboard.hasAnyData === false,
  );

  check(
    "and none of its figures are dressed up as zeros",
    kpi(dashboard, "net").value === "—" &&
      kpi(dashboard, "keyIn").value === "—" &&
      kpi(dashboard, "target").value === "—" &&
      kpi(dashboard, "achievement").value === "—" &&
      kpi(dashboard, "recruitment").value === "—" &&
      kpi(dashboard, "activeHp").value === "—" &&
      kpi(dashboard, "netRatio").value === "—",
  );

  check(
    "a blank figure carries no unit either - '— units' reads as broken",
    dashboard.kpis
      .filter((tile) => tile.value === "—")
      .every((tile) => tile.unit === null),
  );

  check(
    "no eTrust group SHI means no group SHI, never a substitute",
    kpi(dashboard, "shi").value === "—",
  );

  // One week of Key-In and nothing else is still a month with data.
  const oneWeek = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { weekly: [12] } },
  });

  const started = dashboardOf(roster, [oneWeek], oneWeek);

  check(
    "a month with only weekly Key-In is NOT empty - those figures exist",
    started.hasAnyData === true && kpi(started, "keyIn").value === "12",
  );

  check(
    "but its Net is still blank, because no monthly row was saved",
    kpi(started, "net").value === "—",
  );
}

// =============================================================================
section("[12] zero target, zero Key-In, zero net");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);

  const zeroTarget = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 40, target: 0 }, weekly: [40] } },
  });

  const noTarget = dashboardOf(roster, [zeroTarget], zeroTarget);

  check(
    "a target of 0 makes achievement UNKNOWN, not 0% and not Infinity",
    kpi(noTarget, "achievement").value === "—" &&
      noTarget.target.progressPct === null &&
      noTarget.target.hasTarget === false,
  );

  check(
    "the target itself is shown as the entered 0",
    kpi(noTarget, "target").value === "0",
  );

  const zeroKeyIn = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 0, target: 50 } } },
  });

  const noKeyIn = dashboardOf(roster, [zeroKeyIn], zeroKeyIn);

  check(
    "no Key-In makes Net Ratio unknown - never NaN, never 0%",
    kpi(noKeyIn, "netRatio").value === "—",
  );

  check(
    "an entered Net of 0 is shown as 0, because it was actually entered",
    kpi(noKeyIn, "net").value === "0",
  );

  check(
    "achievement against a real target with 0 net is 0.0%, which is meaningful",
    kpi(noKeyIn, "achievement").value === "0.0%",
  );

  const zeroWeek = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 0, target: 50 }, weekly: [0, 0] } },
  });

  const entered = dashboardOf(roster, [zeroWeek], zeroWeek);

  check(
    "entered zero weeks give a real Key-In of 0, shown as 0 and not as blank",
    kpi(entered, "keyIn").value === "0",
  );

  check(
    "but a Key-In of 0 is still a zero denominator, so Net Ratio stays unknown",
    kpi(entered, "netRatio").value === "—",
  );
}

// =============================================================================
section("[13] month over month");
// =============================================================================

{
  const dashboard = dashboardOf(TEAM, [JULY, AUGUST, SEPTEMBER], SEPTEMBER);
  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [JULY, AUGUST, SEPTEMBER], SEPTEMBER),
  )!;

  const { monthOverMonth: mom } = dashboard;

  check(
    "it compares against the immediately previous month, named",
    mom.hasPreviousMonth && mom.previousMonthLabel === "August 2026",
  );

  check(
    "the change is the engine's, formatted with its sign",
    mom.changeUnitsLabel ===
      formatSignedUnits(performance.previousMonth.differenceUnits) &&
      mom.changeUnitsLabel === "+20",
  );

  check(
    "the percentage is the engine's",
    mom.changePercentageLabel ===
      formatSignedPercentage(performance.previousMonth.percentageChange),
  );

  check(
    "both months' figures are shown, so the change can be checked",
    mom.previousNetLabel === "250" && mom.currentNetLabel === "270",
  );

  check("a rise is flagged as up", mom.direction === "up");

  // No August at all.
  const alone = dashboardOf(TEAM, [SEPTEMBER], SEPTEMBER).monthOverMonth;

  check(
    "with no previous month it says so instead of showing a number",
    alone.hasPreviousMonth === false &&
      alone.emptyMessage === "No previous month data",
  );

  check(
    "and reports no change at all - not +100%, not +∞%",
    alone.changeUnitsLabel === "—" &&
      alone.changePercentageLabel === "—" &&
      alone.previousNetLabel === "—" &&
      alone.direction === "unknown",
  );

  // An August that was opened but never keyed in.
  const emptyAugust = buildMonthRecords(TEAM, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: {},
  });

  const againstEmpty = dashboardOf(
    TEAM,
    [emptyAugust, SEPTEMBER],
    SEPTEMBER,
  ).monthOverMonth;

  check(
    "an August nobody keyed in is 'no data', not a month of zero sales",
    againstEmpty.hasPreviousMonth === false &&
      againstEmpty.changePercentageLabel === "—",
  );

  // A genuine zero August: rows exist, and they say zero.
  const zeroAugust = buildMonthRecords(TEAM, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: { Alpha: { monthly: { net: 0 } } },
  });

  const againstZero = dashboardOf(
    TEAM,
    [zeroAugust, SEPTEMBER],
    SEPTEMBER,
  ).monthOverMonth;

  check(
    "against a real zero month the unit change stands but the percentage does not",
    againstZero.hasPreviousMonth &&
      againstZero.changeUnitsLabel === "+270" &&
      againstZero.changePercentageLabel === "—",
  );
}

// =============================================================================
section("[14] quarter to date");
// =============================================================================

{
  const full = dashboardOf(TEAM, [JULY, AUGUST, SEPTEMBER], SEPTEMBER);
  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [JULY, AUGUST, SEPTEMBER], SEPTEMBER),
  )!;

  check(
    "the quarter is named and the totals are the engine's",
    full.qtd.quarterLabel === "Q3 2026" &&
      full.qtd.netLabel === formatUnits(performance.qtd.netUnits) &&
      full.qtd.netLabel === "750",
  );

  check(
    "QTD recruitment is the engine's sum of monthly recruitment",
    full.qtd.recruitmentLabel === formatUnits(performance.qtd.recruitment) &&
      full.qtd.recruitmentLabel === "18",
  );

  check(
    "a complete quarter to date says so",
    full.qtd.isComplete &&
      full.qtd.monthsLabel === "3 of 3 months" &&
      full.qtd.incompleteMessage === null,
  );

  const missingJuly = dashboardOf(TEAM, [AUGUST, SEPTEMBER], SEPTEMBER);

  check(
    "a quarter missing a month is never presented as complete",
    missingJuly.qtd.isComplete === false &&
      missingJuly.qtd.monthsLabel === "2 of 3 months",
  );

  check(
    "and the missing month is named rather than counted as zero",
    missingJuly.qtd.incompleteMessage === "No data yet: July 2026" &&
      missingJuly.qtd.netLabel === "520",
    missingJuly.qtd.incompleteMessage ?? "null",
  );

  const firstOfQuarter = dashboardOf(TEAM, [JULY], JULY);

  check(
    "the first month of a quarter is a one-month quarter to date",
    firstOfQuarter.qtd.quarterLabel === "Q3 2026" &&
      firstOfQuarter.qtd.monthsLabel === "1 of 1 months" &&
      firstOfQuarter.qtd.isComplete,
  );
}

// =============================================================================
section("[15] an HM who has left keeps the month they worked");
// =============================================================================

{
  const roster = createRoster([
    "Alpha",
    { name: "Zulu", status: "inactive", displayOrder: 9 },
  ]);

  const month = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 40, target: 50 } },
      Zulu: { monthly: { net: 90, target: 50 } },
    },
  });

  const dashboard = dashboardOf(roster, [month], month);

  check(
    "their units still count towards the group total",
    kpi(dashboard, "net").value === "130",
  );

  check(
    "they still appear, ranked on what they sold",
    dashboard.hms[0]!.name === "Zulu" && dashboard.hms[0]!.rank === 1,
  );

  check(
    "and the card can mark them inactive",
    dashboard.hms[0]!.isActive === false && dashboard.hms[1]!.isActive === true,
  );

  check(
    "but they are not counted as an outstanding record",
    dashboard.completeness.activeHmCount === 1,
  );
}

// =============================================================================
section("[16] the layout contract the dashboard is built to");
// =============================================================================

/**
 * Structural checks on the components themselves.
 *
 * A stylesheet cannot be exercised in Node, so what is guarded here is the
 * handful of layout decisions that would be a real regression if somebody
 * removed them: the mobile KPI grid, the stacked HM cards, and the fact that
 * only two components in the dashboard ship JavaScript.
 */
{
  const groupKpis = read("components/dashboard/group-kpis.tsx");

  check(
    "KPI cards are a 2-column grid until lg, 4 above it",
    groupKpis.includes("grid-cols-2") && groupKpis.includes("lg:grid-cols-4"),
  );

  const hmGrid = read("components/dashboard/hm-performance.tsx");

  check(
    "HM cards stack in one column on mobile and widen from sm",
    hmGrid.includes("sm:grid-cols-2") && hmGrid.includes("xl:grid-cols-3"),
  );

  const page = read("app/(app)/dashboard/page.tsx");

  check(
    "the weekly chart and the context panel share a row only from lg up",
    page.includes("lg:grid-cols-3") && page.includes("lg:col-span-2"),
  );

  const clientComponents = [
    "components/dashboard/month-switcher.tsx",
    "components/dashboard/refresh-button.tsx",
  ];

  check(
    "the month switcher and refresh button are the only client components",
    clientComponents.every((file) => read(file).startsWith('"use client"')),
  );

  const serverComponents = [
    "components/dashboard/group-kpis.tsx",
    "components/dashboard/kpi-card.tsx",
    "components/dashboard/weekly-keyin.tsx",
    "components/dashboard/hm-card.tsx",
    "components/dashboard/hm-performance.tsx",
    "components/dashboard/period-summary.tsx",
    "components/dashboard/completeness-banner.tsx",
    "components/dashboard/target-progress.tsx",
    "app/(app)/dashboard/page.tsx",
  ];

  check(
    "everything else renders on the server, shipping no JavaScript",
    serverComponents.every((file) => !read(file).includes('"use client"')),
  );

  check(
    "the page reads the month from the URL, so a refresh keeps it",
    page.includes("searchParams") && page.includes("parseMonthParam"),
  );
}

// =============================================================================
section("[17] no dashboard component recomputes a business figure");
// =============================================================================

/**
 * The Stage 4 rule, enforced rather than remembered.
 *
 * Components receive presenter models made of strings and statuses. If one of
 * them reaches for a raw engine field - `totalNet`, `achievementPct`,
 * `netUnits` - it is about to do arithmetic that already has a definition
 * somewhere else, which is the one thing this stage is not allowed to do.
 */
{
  const files = [
    "components/dashboard/group-kpis.tsx",
    "components/dashboard/kpi-card.tsx",
    "components/dashboard/weekly-keyin.tsx",
    "components/dashboard/hm-card.tsx",
    "components/dashboard/hm-performance.tsx",
    "components/dashboard/period-summary.tsx",
    "components/dashboard/completeness-banner.tsx",
    "components/dashboard/target-progress.tsx",
    "components/dashboard/dashboard-header.tsx",
    "components/dashboard/dashboard-states.tsx",
    "app/(app)/dashboard/page.tsx",
  ];

  const rawFields = [
    "totalNet",
    "totalKeyIn",
    "totalTarget",
    "totalRecruitment",
    "totalActiveHp",
    "groupAchievementPct",
    "groupNetRatioPct",
    "groupShiPct",
    "netUnits",
    "achievementPct",
    "netRatioPct",
    "targetNetUnits",
    "keyInUnits",
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

  const calculationImports = files.filter((file) => {
    const source = read(file);

    if (!source.includes("@/lib/calculations")) {
      return false;
    }

    // The one allowed import: the locked weekly thresholds, so the chart legend
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

  const presenter = read("lib/view-models/dashboard.ts");

  check(
    "the presenter formats with the engine's own helpers",
    presenter.includes("formatPercentage") &&
      presenter.includes("formatUnits") &&
      presenter.includes('from "@/lib/calculations"'),
  );
}

// =============================================================================
section("[18] the dashboard fetch stays a fixed number of queries");
// =============================================================================

{
  const source = read("lib/data/dashboard.ts");

  const selects = source.match(/\.from\(/g) ?? [];

  check(
    "seven queries: months, hms, weeks, monthly, group SHI, Active HP, weekly Key-In",
    selects.length === 7,
    `found ${selects.length}`,
  );

  check(
    "Active HP is COUNTED in the database, not fetched HP by HP",
    source.includes('.from("hm_monthly_hp_summary")') &&
      !source.includes('.from("hp_monthly_performance")'),
  );

  check(
    "the month lists are fetched with `in`, never one query per month",
    source.includes('.in("month_id", monthIds)') &&
      source.includes('.in(\n        "week_id",'),
  );

  check(
    "it never reaches for the service-role client",
    !source.includes("admin") && source.includes("createSupabaseServerClient"),
  );

  check(
    "the freshness stamp is scoped to the selected month",
    source.includes("latestUpdate(") &&
      source.includes("      selectedMonth.id,"),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
