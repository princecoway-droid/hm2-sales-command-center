/**
 * Stage 3 tests: the calculation engine and the aggregation layer.
 *
 *   npm run test:stage3
 *
 * Same shape as Stage 1 and Stage 2 - plain Node, no framework, one file. The
 * fixtures live in tests/fixtures.mts so a scenario is a few lines of spec
 * rather than a page of literal rows.
 *
 * What this suite is really guarding, over and above the arithmetic:
 *
 *   * a figure that cannot be calculated is `null`, never NaN, Infinity or 0;
 *   * blank is not zero, and a missing month is not a zero month;
 *   * group percentages come off group totals, never off HM percentages;
 *   * group SHI is read, never derived;
 *   * an inactive HM keeps the history they earned.
 */

import {
  buildHmMonthInputs,
  calculateDataCompleteness,
  calculateGroupMonthlyPerformance,
  calculateGroupWeeklyKeyIn,
  calculateHmMonthlyPerformance,
  calculateHmMonthlyPerformances,
  calculateHmRankings,
  calculatePreviousMonthComparison,
  calculateQtdPerformance,
  calculateSplitPercentages,
  calculateWeeklyPerformance,
  findRank,
  firstMonthOfQuarter,
  formatPercentage,
  monthsRequiredFor,
  netRatio,
  previousYearMonth,
  quarterMonthsToDate,
  quarterOf,
  selectHmsForMonth,
  splitBalance,
  sumKeyIn,
  toMonthInput,
  toSalesWeekInput,
  type HMMonthlyCalculatedPerformance,
  type QtdMonthContribution,
  type YearMonth,
} from "@/lib/calculations";
import {
  buildMonthlyPerformanceViewModel,
  type MonthPerformanceRecords,
  type PerformanceBundle,
} from "@/lib/view-models/monthly-performance";

import {
  FOUR_WEEKS,
  SEPTEMBER_WEEKS,
  buildGroupMetrics,
  buildMonthRecords,
  createRoster,
  hmId,
  rosterList,
  singleHmMonth,
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

/** Percentages are irrational more often than not; compare within a whisker. */
const close = (value: number | null, expected: number, epsilon = 1e-9) =>
  value !== null && Math.abs(value - expected) < epsilon;

/** Nothing anywhere in a model may be NaN or Infinity. */
const isSane = (value: unknown): boolean =>
  typeof value !== "number" || Number.isFinite(value);

function everyNumberFinite(model: unknown): boolean {
  if (Array.isArray(model)) {
    return model.every(everyNumberFinite);
  }

  if (model && typeof model === "object") {
    return Object.values(model).every(everyNumberFinite);
  }

  return isSane(model);
}

// -----------------------------------------------------------------------------
// Helpers over the fixtures
// -----------------------------------------------------------------------------

function calculateOneMonth(
  roster: Roster,
  records: MonthPerformanceRecords,
  groupShiPct: number | null = null,
) {
  const weeks = records.weeks.map(toSalesWeekInput);

  const inputs = buildHmMonthInputs({
    hms: rosterList(roster),
    weeks: records.weeks,
    monthly: records.monthly,
    weekly: records.weekly,
  });

  return calculateGroupMonthlyPerformance({
    month: toMonthInput(records.month),
    weeks,
    hms: calculateHmMonthlyPerformances(inputs, weeks),
    groupShiPct,
  });
}

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

function hmNamed(
  group: { hms: HMMonthlyCalculatedPerformance[] },
  name: string,
): HMMonthlyCalculatedPerformance {
  const found = group.hms.find((hm) => hm.hmName === name);

  if (!found) {
    throw new Error(`Test error: no calculated HM named "${name}".`);
  }

  return found;
}

// =============================================================================
console.log("\n[S3-A] the worked example, end to end");
// =============================================================================

{
  // Key-In 20 + 18 + 13 + 21 = 72, Net 72 against a target of 100,
  // split 28 Extrade + 44 Non-Extrade.
  const { roster, records } = singleHmMonth({
    monthly: { net: 72, target: 100, extrade: 28, nonExtrade: 44 },
    weekly: [20, 18, 13, 21, null],
  });

  const group = calculateOneMonth(roster, records);
  const hm = group.hms[0]!;

  check("Key-In 20+18+13+21 totals 72", hm.totalKeyIn === 72);
  check("Net is 72", hm.netUnits === 72);
  check("Target is 100", hm.targetNetUnits === 100);
  check("Achievement 72/100 is 72%", close(hm.achievementPct, 72));
  check("Net Ratio 72/72 is 100%", close(hm.netRatioPct, 100));
  check("Extrade 28 of 72 is 38.9%", formatPercentage(hm.extradePct) === "38.9%");
  check(
    "Non-Extrade 44 of 72 is 61.1%",
    formatPercentage(hm.nonExtradePct) === "61.1%",
  );
  check("Extrade + Non-Extrade = Net, so the balance is 0", hm.splitBalance === 0);
  check(
    "the two shares add back to 100%",
    close((hm.extradePct ?? 0) + (hm.nonExtradePct ?? 0), 100, 1e-9),
  );
  check("nothing in the HM model is NaN or Infinity", everyNumberFinite(hm));
}

check("Net Ratio 72 of 80 keyed in is 90%", close(netRatio(72, 80), 90));
check("Net Ratio with nothing keyed in is null, not 0%", netRatio(72, 0) === null);
check("Net Ratio of a blank Net is null", netRatio(null, 80) === null);

{
  const split = calculateSplitPercentages(72, 28, 44);
  check(
    "calculateSplitPercentages agrees with the parts",
    formatPercentage(split.extradePct) === "38.9%" &&
      formatPercentage(split.nonExtradePct) === "61.1%" &&
      split.balance === 0,
  );
}

check(
  "splitBalance is positive when the split over-counts Net",
  splitBalance(72, 30, 44) === 2,
);
check(
  "splitBalance is negative while Net is not fully allocated",
  splitBalance(72, 28, 40) === -4,
);
check("splitBalance is null while any part is blank", splitBalance(72, null, 44) === null);

// =============================================================================
console.log("\n[S3-B] edge cases: no NaN, no Infinity, no silent zero");
// =============================================================================

{
  // Target 0, Net 0, no Key-In, no split - every denominator gone at once.
  const { roster, records } = singleHmMonth({
    monthly: { net: 0, target: 0, recruitment: 0, activeHp: 0, shi: 0 },
    weekly: [null, null, null, null, null],
  });

  const group = calculateOneMonth(roster, records);
  const hm = group.hms[0]!;

  check("a target of 0 gives a null achievement, not Infinity", hm.achievementPct === null);
  check("Key-In of 0 gives a null net ratio, not NaN", hm.netRatioPct === null);
  check("Net of 0 gives null Extrade percentages", hm.extradePct === null);
  check("Net of 0 gives null Non-Extrade percentages", hm.nonExtradePct === null);
  check("an entered zero recruitment is red, not neutral", hm.recruitmentStatus === "red");
  check("an entered zero recruitment is 0, not null", hm.recruitment === 0);
  check("an entered zero Active HP is 0, not null", hm.activeHp === 0);
  check("an entered zero SHI is 0, not null", hm.shiPct === 0);
  check("a zero split still balances", hm.splitBalance === 0);
  check("total Key-In of an all-blank month is 0", hm.totalKeyIn === 0);
  check("no figure in the model is NaN or Infinity", everyNumberFinite(group));
}

{
  // No monthly record at all. Every figure must be null, not zero.
  const { roster, records } = singleHmMonth({ weekly: [20, null, null, null, null] });
  const hm = calculateOneMonth(roster, records).hms[0]!;

  check("no monthly record: Net is null, not 0", hm.netUnits === null);
  check("no monthly record: Target is null", hm.targetNetUnits === null);
  check("no monthly record: recruitment is null", hm.recruitment === null);
  check("no monthly record: Active HP is null", hm.activeHp === null);
  check("no monthly record: SHI is null", hm.shiPct === null);
  check("no monthly record: achievement is null", hm.achievementPct === null);
  check("no monthly record: net ratio is null", hm.netRatioPct === null);
  check("no monthly record: split balance is null", hm.splitBalance === null);
  check("blank recruitment is neutral, NOT red", hm.recruitmentStatus === "neutral");
  check("weekly Key-In still totals from the entered weeks", hm.totalKeyIn === 20);
  check("presence says the monthly record is missing", !hm.presence.hasMonthlyRecord);
  check("presence still reports data, because a week was entered", hm.presence.hasAnyData);
}

{
  // Zero Extrade / zero Non-Extrade against a real Net.
  const allNonExtrade = singleHmMonth({
    monthly: { net: 60, target: 60, extrade: 0, nonExtrade: 60 },
  });
  const hm = calculateOneMonth(allNonExtrade.roster, allNonExtrade.records).hms[0]!;

  check("zero Extrade against a real Net is 0%, not null", close(hm.extradePct, 0));
  check("all Non-Extrade is 100%", close(hm.nonExtradePct, 100));
  check("the split still balances", hm.splitBalance === 0);
}

// =============================================================================
console.log("\n[S3-C] weekly model: dates come from the configured weeks");
// =============================================================================

{
  const { roster, records } = singleHmMonth({
    monthly: { net: 40, target: 50 },
    weekly: [20, 15, null, 9, 16],
  });

  const hm = calculateOneMonth(roster, records).hms[0]!;
  const weeks = hm.weeklyPerformance;

  check("one entry per configured week, however many there are", weeks.length === 5);
  check(
    "W1 carries the configured period, which opens in the previous month",
    weeks[0]!.startDate === "2026-08-30" && weeks[0]!.endDate === "2026-09-05",
    `${weeks[0]!.startDate} - ${weeks[0]!.endDate}`,
  );
  check("W5 is the short end-of-month period", weeks[4]!.endDate === "2026-09-30");
  check("W1 20 units is green and entered", weeks[0]!.status === "green" && weeks[0]!.isEntered);
  check("W2 15 units is YELLOW at the boundary", weeks[1]!.status === "yellow");
  check(
    "W3 blank is neutral and not entered",
    weeks[2]!.status === "neutral" && !weeks[2]!.isEntered && weeks[2]!.keyInUnits === null,
  );
  check("W4 9 units is red", weeks[3]!.status === "red");
  check("W5 16 units is green", weeks[4]!.status === "green");
  check("the blank week contributes nothing to the total", hm.totalKeyIn === 60);
  check("weeks entered and blank are counted separately", hm.presence.weeksEntered === 4 && hm.presence.weeksBlank === 1);
  check("week labels come through", weeks[0]!.weekLabel === "W1");
}

{
  // A month with a different, shorter calendar - nothing assumes five weeks.
  const roster = createRoster(["Alpha"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: { Alpha: { monthly: { net: 30, target: 30 }, weekly: [10, 10, 10, 10] } },
  });

  const hm = calculateOneMonth(roster, records).hms[0]!;

  check("a four-week month produces four weekly entries", hm.weeklyPerformance.length === 4);
  check("its Key-In totals 40", hm.totalKeyIn === 40);
  check("weeksConfigured follows the calendar, not a constant", hm.presence.weeksConfigured === 4);
}

check(
  "an entered zero week is entered, and red - not blank",
  calculateWeeklyPerformance(
    [{ weekId: "w1", weekNumber: 1, weekLabel: "W1", startDate: "2026-09-01", endDate: "2026-09-07" }],
    { w1: 0 },
  )[0]!.isEntered,
);
check(
  "a week with no row is blank, and neutral",
  calculateWeeklyPerformance(
    [{ weekId: "w1", weekNumber: 1, weekLabel: "W1", startDate: "2026-09-01", endDate: "2026-09-07" }],
    {},
  )[0]!.status === "neutral",
);

// =============================================================================
console.log("\n[S3-D] status boundaries (locked - Stage 2 behaviour preserved)");
// =============================================================================

{
  const statuses = (values: number[]) =>
    calculateWeeklyPerformance(
      values.map((_, index) => ({
        weekId: `w${index}`,
        weekNumber: index + 1,
        weekLabel: `W${index + 1}`,
        startDate: "2026-09-01",
        endDate: "2026-09-07",
      })),
      Object.fromEntries(values.map((value, index) => [`w${index}`, value])),
    ).map((week) => week.status);

  const [nine, ten, fifteen, sixteen] = statuses([9, 10, 15, 16]);

  check("weekly 9 is red", nine === "red");
  check("weekly 10 is yellow", ten === "yellow");
  check("weekly 15 is yellow, NOT green", fifteen === "yellow");
  check("weekly 16 is green", sixteen === "green");
}

{
  const recruitmentFor = (value: number | undefined) => {
    const { roster, records } = singleHmMonth({
      monthly: value === undefined ? undefined : { net: 0, recruitment: value },
    });

    return calculateOneMonth(roster, records).hms[0]!.recruitmentStatus;
  };

  check("recruitment 0 is red", recruitmentFor(0) === "red");
  check("recruitment 1 is yellow", recruitmentFor(1) === "yellow");
  check("recruitment 2 is yellow", recruitmentFor(2) === "yellow");
  check("recruitment 3 is green", recruitmentFor(3) === "green");
  check("recruitment not entered is neutral", recruitmentFor(undefined) === "neutral");
}

// =============================================================================
console.log("\n[S3-E] group aggregation: totals from HM data, never averages");
// =============================================================================

const TEAM = createRoster(["Alpha", "Bravo", "Charlie", "Delta"]);

const SEPTEMBER = buildMonthRecords(TEAM, {
  year: 2026,
  month: 9,
  weeks: SEPTEMBER_WEEKS,
  hms: {
    Alpha: {
      monthly: { net: 76, target: 100, recruitment: 4, activeHp: 12, shi: 50, extrade: 30, nonExtrade: 46 },
      weekly: [20, 18, 13, 21, 4],
    },
    Bravo: {
      monthly: { net: 71, target: 90, recruitment: 2, activeHp: 10, shi: 90, extrade: 21, nonExtrade: 50 },
      weekly: [18, 17, 16, 15, 4],
    },
    Charlie: {
      monthly: { net: 65, target: 80, recruitment: 0, activeHp: 9, shi: 70, extrade: 15, nonExtrade: 50 },
      weekly: [16, 16, 14, 14, 3],
    },
    Delta: {
      monthly: { net: 58, target: 80, recruitment: 3, activeHp: 8, shi: 60, extrade: 10, nonExtrade: 48 },
      weekly: [14, 15, 13, 13, 2],
    },
  },
});

{
  const group = calculateOneMonth(TEAM, SEPTEMBER, 72);

  check("Group Net 76+71+65+58 = 270", group.totalNet === 270);
  check("Group Target 100+90+80+80 = 350", group.totalTarget === 350);
  check(
    "Group Key-In is the sum of every HM weekly figure",
    group.totalKeyIn === 76 + 70 + 63 + 57,
    `got ${group.totalKeyIn}`,
  );
  check(
    "Group Achievement 270/350 is 77.14%",
    formatPercentage(group.groupAchievementPct, { digits: 2 }) === "77.14%",
  );
  check("Group Recruitment 4+2+0+3 = 9", group.totalRecruitment === 9);
  check("Group Active HP 12+10+9+8 = 39", group.totalActiveHp === 39);
  check("Group Extrade 30+21+15+10 = 76", group.totalExtrade === 76);
  check("Group Non-Extrade 46+50+50+48 = 194", group.totalNonExtrade === 194);
  check(
    "Group Extrade + Non-Extrade = Group Net",
    group.totalExtrade + group.totalNonExtrade === group.totalNet && group.groupSplitBalance === 0,
  );
  check(
    "Group Net Ratio is 270 / total Key-In, from the totals",
    close(group.groupNetRatioPct, (270 / group.totalKeyIn) * 100),
  );

  // The averaging trap, stated as a test so a future refactor cannot slip past.
  const meanOfHmRatios =
    group.hms.reduce((sum, hm) => sum + (hm.netRatioPct ?? 0), 0) / group.hms.length;

  check(
    "Group Net Ratio is NOT the mean of the HM net ratios",
    !close(group.groupNetRatioPct, meanOfHmRatios, 1e-6),
    `group ${group.groupNetRatioPct} vs mean ${meanOfHmRatios}`,
  );

  const meanOfHmAchievement =
    group.hms.reduce((sum, hm) => sum + (hm.achievementPct ?? 0), 0) / group.hms.length;

  check(
    "Group Achievement is NOT the mean of the HM achievements",
    !close(group.groupAchievementPct, meanOfHmAchievement, 1e-6),
    `group ${group.groupAchievementPct} vs mean ${meanOfHmAchievement}`,
  );

  check(
    "Group Extrade % is 76/270, off the totals",
    close(group.groupExtradePct, (76 / 270) * 100),
  );
  check(
    "Group Extrade % + Non-Extrade % = 100",
    close((group.groupExtradePct ?? 0) + (group.groupNonExtradePct ?? 0), 100, 1e-9),
  );
  check("nothing in the group model is NaN or Infinity", everyNumberFinite(group));
}

console.log("\n[S3-F] weekly group Key-In");

{
  const group = calculateOneMonth(TEAM, SEPTEMBER, 72);
  const weekly = group.weeklyGroupKeyIn;

  check("one column per configured week", weekly.length === 5);
  check("W1 sums 20+18+16+14 = 68", weekly[0]!.keyInUnits === 68);
  check("W5 sums 4+4+3+2 = 13", weekly[4]!.keyInUnits === 13);
  check(
    "the weekly columns add up to the group total",
    weekly.reduce((sum, week) => sum + week.keyInUnits, 0) === group.totalKeyIn,
  );
  check("each column carries its configured dates", weekly[0]!.startDate === "2026-08-30");
  check("each column counts the HMs who entered it", weekly[0]!.hmsEntered === 4);
}

{
  // A month in progress: W1 only. The totals must still be meaningful.
  const partial = buildMonthRecords(TEAM, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 20, target: 100 }, weekly: [20, null, null, null, null] },
      Bravo: { weekly: [18, null, null, null, null] },
    },
  });

  const group = calculateOneMonth(TEAM, partial);

  check("a part-entered month still totals its Key-In", group.totalKeyIn === 38);
  check("W1 is entered", group.weeklyGroupKeyIn[0]!.isEntered);
  check(
    "a week nobody has entered is 0 units but NOT flagged entered",
    group.weeklyGroupKeyIn[1]!.keyInUnits === 0 && !group.weeklyGroupKeyIn[1]!.isEntered,
  );
  check("only the HM with a record contributes to Net", group.totalNet === 20);
  check("contributors names how many HMs supplied a Net", group.contributors.net === 1);
}

// =============================================================================
console.log("\n[S3-G] group SHI is READ from eTrust, never derived");
// =============================================================================

{
  // Deliberately far from any average of the HM values.
  const pair = createRoster(["Alpha", "Bravo"]);
  const records = buildMonthRecords(pair, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 10, target: 10, shi: 50 } },
      Bravo: { monthly: { net: 10, target: 10, shi: 90 } },
    },
  });

  const group = calculateOneMonth(pair, records, 72);

  check("HM SHI values are 50 and 90", hmNamed(group, "Alpha").shiPct === 50 && hmNamed(group, "Bravo").shiPct === 90);
  check("Group SHI is the eTrust figure, 72", group.groupShiPct === 72);
  check("Group SHI is NOT the mean of 50 and 90 (70)", group.groupShiPct !== 70);

  const missing = calculateOneMonth(pair, records, null);

  check("a missing group_monthly_metrics row gives null", missing.groupShiPct === null);
  check("it does NOT fall back to an HM average", missing.groupShiPct !== 70);

  // The record itself, through the fixture that mirrors the table.
  const metrics = buildGroupMetrics(records.month.id, 72);
  check(
    "the value passed through is the one on group_monthly_metrics",
    calculateOneMonth(pair, records, metrics.shi_percentage).groupShiPct === 72,
  );
}

// =============================================================================
console.log("\n[S3-H] completeness: monthly records and weekly cells are separate");
// =============================================================================

{
  const three = createRoster(["Alpha", "Bravo", "Charlie"]);

  const complete = calculateOneMonth(
    three,
    buildMonthRecords(three, {
      year: 2026,
      month: 9,
      hms: {
        Alpha: { monthly: { net: 10, target: 10 } },
        Bravo: { monthly: { net: 10, target: 10 } },
        Charlie: { monthly: { net: 10, target: 10 } },
      },
    }),
  ).dataCompleteness;

  check("3 active HMs, 3 records: complete", complete.isComplete);
  check("all three counted", complete.activeHmCount === 3 && complete.hmRecordsPresent === 3);
  check("nobody missing", complete.missingHmIds.length === 0);

  const partial = calculateOneMonth(
    three,
    buildMonthRecords(three, {
      year: 2026,
      month: 9,
      hms: {
        Alpha: { monthly: { net: 10, target: 10 } },
        Bravo: { monthly: { net: 10, target: 10 } },
      },
    }),
  ).dataCompleteness;

  check("3 active HMs, 2 records: incomplete", !partial.isComplete);
  check("2 present, 1 missing", partial.hmRecordsPresent === 2 && partial.missingHmIds.length === 1);
  check("the missing HM is named", partial.missingHmIds[0] === hmId(three, "Charlie"));

  const none = calculateOneMonth(
    three,
    buildMonthRecords(three, { year: 2026, month: 9, hms: {} }),
  ).dataCompleteness;

  check("no records at all: incomplete", !none.isComplete);
  check("all three are missing", none.missingHmIds.length === 3);
  check("weekly cells expected is 3 HMs x 5 weeks", none.weeklyCellsExpected === 15);

  // The point of the whole model: a month in progress is not an invalid month.
  const inProgress = calculateOneMonth(
    three,
    buildMonthRecords(three, {
      year: 2026,
      month: 9,
      hms: {
        Alpha: { monthly: { net: 10, target: 10 }, weekly: [20, null, null, null, null] },
        Bravo: { monthly: { net: 10, target: 10 }, weekly: [18, null, null, null, null] },
        Charlie: { monthly: { net: 10, target: 10 }, weekly: [null, null, null, null, null] },
      },
    }),
  ).dataCompleteness;

  check(
    "weekly blanks do NOT make a month with every record incomplete",
    inProgress.isComplete,
  );
  check(
    "weekly entry is reported separately: 2 of 15 cells",
    inProgress.weeklyCellsEntered === 2 && inProgress.weeklyCellsExpected === 15,
  );
}

check(
  "an empty roster is not 'complete' - there is nothing to be complete about",
  !calculateDataCompleteness([], 5).isComplete,
);

// =============================================================================
console.log("\n[S3-I] historical data survives deactivation");
// =============================================================================

{
  // Bravo has since left. August is theirs; September is not.
  const team = createRoster([
    { name: "Alpha" },
    { name: "Bravo", status: "inactive", displayOrder: 1 },
  ]);

  const august = buildMonthRecords(team, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: {
      Alpha: { monthly: { net: 40, target: 50 }, weekly: [10, 10, 10, 10] },
      Bravo: { monthly: { net: 35, target: 50 }, weekly: [9, 9, 9, 8] },
    },
  });

  const augustGroup = calculateOneMonth(team, august);

  check("August still includes the HM who has since left", augustGroup.hms.length === 2);
  check("their Net still counts towards the group total: 40+35 = 75", augustGroup.totalNet === 75);
  check("their Key-In still counts: 40+35 = 75", augustGroup.totalKeyIn === 75);
  check("they are flagged inactive so the UI can mark them", !hmNamed(augustGroup, "Bravo").isActive);
  check(
    "an inactive HM is NOT an outstanding record - only active HMs are chased",
    augustGroup.dataCompleteness.activeHmCount === 1 &&
      augustGroup.dataCompleteness.isComplete,
  );
  check(
    "they are counted as carried history",
    augustGroup.dataCompleteness.inactiveWithHistoryCount === 1 &&
      augustGroup.dataCompleteness.includedHmCount === 2,
  );

  const september = buildMonthRecords(team, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 42, target: 50 }, weekly: [11, 11, 10, 10, null] } },
  });

  const septemberGroup = calculateOneMonth(team, september);

  check(
    "September drops the departed HM entirely - they are not a missing record",
    septemberGroup.hms.length === 1 && septemberGroup.dataCompleteness.missingHmIds.length === 0,
  );
  check("September totals only the active HM", septemberGroup.totalNet === 42);

  // The month somebody leaves in: partial figures still count.
  const leaving = buildMonthRecords(team, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 42, target: 50 } },
      Bravo: { monthly: { net: 8, target: 50 }, weekly: [8, null, null, null, null] },
    },
  });

  const leavingGroup = calculateOneMonth(team, leaving);

  check(
    "an inactive HM WITH data for the month is included - those units were sold",
    leavingGroup.hms.length === 2 && leavingGroup.totalNet === 50,
  );
}

check(
  "selectHmsForMonth keeps active HMs and inactive HMs with data, drops the rest",
  (() => {
    const roster = createRoster([
      { name: "Active" },
      { name: "LeftWithData", status: "inactive" },
      { name: "LeftNoData", status: "inactive" },
    ]);

    const selected = selectHmsForMonth(
      rosterList(roster),
      [{ hm_id: hmId(roster, "LeftWithData") }],
      [],
    );

    return (
      selected.length === 2 &&
      selected.some((hm) => hm.name === "Active") &&
      selected.some((hm) => hm.name === "LeftWithData")
    );
  })(),
);

// =============================================================================
console.log("\n[S3-J] ranking");
// =============================================================================

{
  const group = calculateOneMonth(TEAM, SEPTEMBER, 72);
  const ranked = calculateHmRankings(group.hms);

  check(
    "default ranking is Net descending: 76, 71, 65, 58",
    ranked.map((entry) => entry.value).join(",") === "76,71,65,58",
    ranked.map((entry) => `${entry.performance.hmName}:${entry.value}`).join(" "),
  );
  check("ranks are 1..n", ranked.map((entry) => entry.rank).join(",") === "1,2,3,4");
  check("rank 1 is the top HM", ranked[0]!.performance.hmName === "Alpha");
  check("findRank locates an HM", findRank(ranked, hmId(TEAM, "Charlie"))?.rank === 3);
  check("findRank returns null for a stranger", findRank(ranked, "not-an-id") === null);

  const byKeyIn = calculateHmRankings(group.hms, { metric: "keyInUnits" });
  check("ranking by Key-In puts the biggest Key-In first", byKeyIn[0]!.value === 76);

  const byRecruitment = calculateHmRankings(group.hms, { metric: "recruitment" });
  check("ranking by recruitment: 4, 3, 2, 0", byRecruitment.map((e) => e.value).join(",") === "4,3,2,0");

  const ascending = calculateHmRankings(group.hms, { direction: "asc" });
  check("ascending reverses the order", ascending.map((e) => e.value).join(",") === "58,65,71,76");
}

{
  // Two HMs on the same Net; the better achiever is ahead.
  const tied = createRoster([
    { name: "Zulu", displayOrder: 9 },
    { name: "Yankee", displayOrder: 3 },
  ]);

  const records = buildMonthRecords(tied, {
    year: 2026,
    month: 9,
    hms: {
      Zulu: { monthly: { net: 70, target: 100 } },
      Yankee: { monthly: { net: 70, target: 80 } },
    },
  });

  const ranked = calculateHmRankings(calculateOneMonth(tied, records).hms);

  check(
    "a Net tie breaks on Achievement: 70/80 beats 70/100",
    ranked[0]!.performance.hmName === "Yankee",
  );

  // Same Net AND same target - now display_order decides.
  const identical = buildMonthRecords(tied, {
    year: 2026,
    month: 9,
    hms: {
      Zulu: { monthly: { net: 70, target: 100 } },
      Yankee: { monthly: { net: 70, target: 100 } },
    },
  });

  const byOrder = calculateHmRankings(calculateOneMonth(tied, identical).hms);

  check(
    "a full tie falls back to display_order, not database order",
    byOrder[0]!.performance.hmName === "Yankee" && byOrder[0]!.performance.displayOrder === 3,
  );

  // Determinism: shuffled input, identical result.
  const model = calculateOneMonth(tied, identical).hms;
  const shuffled = [...model].reverse();

  check(
    "ranking is deterministic regardless of input order",
    calculateHmRankings(model).map((e) => e.performance.hmId).join() ===
      calculateHmRankings(shuffled).map((e) => e.performance.hmId).join(),
  );
}

{
  // An HM with no target has an UNKNOWN achievement, not the worst one.
  const roster = createRoster(["Known", "NoTarget"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Known: { monthly: { net: 10, target: 100 } },
      NoTarget: { monthly: { net: 10, target: 0 } },
    },
  });

  const ranked = calculateHmRankings(calculateOneMonth(roster, records).hms, {
    metric: "achievementPct",
  });

  check("a null achievement sorts LAST, not as a 0", ranked[1]!.value === null);
  check("the HM with a real achievement is first", ranked[0]!.performance.hmName === "Known");
}

{
  const team = createRoster([{ name: "Here" }, { name: "Gone", status: "inactive" }]);
  const records = buildMonthRecords(team, {
    year: 2026,
    month: 9,
    hms: {
      Here: { monthly: { net: 10, target: 10 } },
      Gone: { monthly: { net: 90, target: 10 } },
    },
  });

  const all = calculateHmRankings(calculateOneMonth(team, records).hms);
  const activeOnly = calculateHmRankings(calculateOneMonth(team, records).hms, {
    activeOnly: true,
  });

  check("by default a historical ranking keeps the departed HM", all.length === 2);
  check("activeOnly drops them for a current-month leaderboard", activeOnly.length === 1);
}

// =============================================================================
console.log("\n[S3-K] month over month");
// =============================================================================

check(
  "120 against 100 is +20 units and +20%",
  (() => {
    const mom = calculatePreviousMonthComparison(120, {
      netUnits: 100,
      month: { year: 2026, month: 8 },
    });

    return mom.differenceUnits === 20 && close(mom.percentageChange, 20) && mom.hasPreviousMonthData;
  })(),
);

check(
  "80 against 100 is -20 units and -20%",
  (() => {
    const mom = calculatePreviousMonthComparison(80, {
      netUnits: 100,
      month: { year: 2026, month: 8 },
    });

    return mom.differenceUnits === -20 && close(mom.percentageChange, -20);
  })(),
);

check(
  "equal months are 0 units and 0%",
  (() => {
    const mom = calculatePreviousMonthComparison(100, {
      netUnits: 100,
      month: { year: 2026, month: 8 },
    });

    return mom.differenceUnits === 0 && mom.percentageChange === 0;
  })(),
);

check(
  "a previous month of 0 keeps the unit difference but has NO percentage",
  (() => {
    const mom = calculatePreviousMonthComparison(120, {
      netUnits: 0,
      month: { year: 2026, month: 8 },
    });

    return (
      mom.differenceUnits === 120 &&
      mom.percentageChange === null &&
      mom.previousNetUnits === 0 &&
      mom.hasPreviousMonthData
    );
  })(),
);

check(
  "a MISSING previous month is not a zero one - everything derived is null",
  (() => {
    const mom = calculatePreviousMonthComparison(120, null);

    return (
      !mom.hasPreviousMonthData &&
      mom.previousNetUnits === null &&
      mom.differenceUnits === null &&
      mom.percentageChange === null
    );
  })(),
);

check(
  "an HM with NO record this month gets no comparison, not a collapse to zero",
  (() => {
    const mom = calculatePreviousMonthComparison(
      0,
      { netUnits: 50, month: { year: 2026, month: 8 } },
      { hasCurrentData: false },
    );

    return (
      !mom.hasCurrentMonthData &&
      mom.hasPreviousMonthData &&
      mom.previousNetUnits === 50 &&
      mom.differenceUnits === null &&
      mom.percentageChange === null
    );
  })(),
);

check(
  "a group comparison has current data by default",
  calculatePreviousMonthComparison(120, {
    netUnits: 100,
    month: { year: 2026, month: 8 },
  }).hasCurrentMonthData,
);

check("September's previous month is August", (() => {
  const prev = previousYearMonth({ year: 2026, month: 9 });
  return prev.year === 2026 && prev.month === 8;
})());

check("January's previous month is the previous December", (() => {
  const prev = previousYearMonth({ year: 2027, month: 1 });
  return prev.year === 2026 && prev.month === 12;
})());

// =============================================================================
console.log("\n[S3-L] quarter to date");
// =============================================================================

check("Q of Jan/Mar is 1, Apr/Jun 2, Jul/Sep 3, Oct/Dec 4", (() =>
  quarterOf(1) === 1 && quarterOf(3) === 1 && quarterOf(4) === 2 && quarterOf(6) === 2 &&
  quarterOf(7) === 3 && quarterOf(9) === 3 && quarterOf(10) === 4 && quarterOf(12) === 4)());

check(
  "the quarter's first month: Mar->Jan, Apr->Apr, Jun->Apr, Sep->Jul, Oct->Oct, Dec->Oct",
  firstMonthOfQuarter(3) === 1 &&
    firstMonthOfQuarter(4) === 4 &&
    firstMonthOfQuarter(6) === 4 &&
    firstMonthOfQuarter(9) === 7 &&
    firstMonthOfQuarter(10) === 10 &&
    firstMonthOfQuarter(12) === 10,
);

const monthsOf = (ym: YearMonth) => quarterMonthsToDate(ym).map((m) => m.month).join(",");

check("September 2026 QTD spans Jul, Aug, Sep", monthsOf({ year: 2026, month: 9 }) === "7,8,9");
check("August 2026 QTD spans Jul, Aug - no future months", monthsOf({ year: 2026, month: 8 }) === "7,8");
check("July 2026 QTD is July alone", monthsOf({ year: 2026, month: 7 }) === "7");
check("January 2027 QTD is January alone", monthsOf({ year: 2027, month: 1 }) === "1");
check("March 2026 QTD spans Jan, Feb, Mar", monthsOf({ year: 2026, month: 3 }) === "1,2,3");
check("April 2026 QTD is April alone - a new quarter", monthsOf({ year: 2026, month: 4 }) === "4");
check("June 2026 QTD spans Apr, May, Jun", monthsOf({ year: 2026, month: 6 }) === "4,5,6");
check("October 2026 QTD is October alone", monthsOf({ year: 2026, month: 10 }) === "10");
check("December 2026 QTD spans Oct, Nov, Dec", monthsOf({ year: 2026, month: 12 }) === "10,11,12");

{
  const contribution = (month: number, netUnits: number, recruitment: number): QtdMonthContribution => ({
    month: { year: 2026, month },
    hasData: true,
    netUnits,
    recruitment,
  });

  const full = calculateQtdPerformance({ year: 2026, month: 9 }, [
    contribution(7, 100, 3),
    contribution(8, 120, 4),
    contribution(9, 90, 2),
  ]);

  check("a fully populated quarter totals 310 Net", full.netUnits === 310);
  check("and 9 recruitment", full.recruitment === 9);
  check("it reports as complete", full.isComplete && full.missingMonths.length === 0);
  check("the quarter is Q3", full.quarter === 3);

  // The headline case: the current month has no record yet.
  const running = calculateQtdPerformance({ year: 2026, month: 9 }, [
    contribution(7, 100, 3),
    contribution(8, 120, 4),
  ]);

  check("July 100 + August 120 with no September yet totals 220", running.netUnits === 220);
  check("...and the quarter is NOT complete", !running.isComplete);
  check("September is named as missing", running.missingMonths.length === 1 && running.missingMonths[0]!.month === 9);
  check("2 of 3 months have data", running.monthsWithData === 2);
  check(
    "a missing month contributes 0 but is flagged, not counted as a zero month",
    running.months[2]!.hasData === false && running.months[2]!.netUnits === 0,
  );

  const gap = calculateQtdPerformance({ year: 2026, month: 9 }, [contribution(9, 90, 2)]);

  check("a gap in the middle of the quarter still sums what exists", gap.netUnits === 90);
  check("both earlier months are reported missing", gap.missingMonths.length === 2);

  const empty = calculateQtdPerformance({ year: 2026, month: 9 }, []);

  check("an empty quarter is 0 units and incomplete, not an error", empty.netUnits === 0 && !empty.isComplete);
  check("all three months are missing", empty.missingMonths.length === 3);
}

check(
  "monthsRequiredFor(Sep) is Sep, Aug, Jul - de-duplicated",
  monthsRequiredFor({ year: 2026, month: 9 }).map((m) => m.month).join(",") === "9,8,7",
);
check(
  "monthsRequiredFor(Jul) reaches back into the previous quarter for June",
  monthsRequiredFor({ year: 2026, month: 7 }).map((m) => m.month).join(",") === "7,6",
);
check(
  "monthsRequiredFor(Jan) crosses the year boundary",
  (() => {
    const months = monthsRequiredFor({ year: 2027, month: 1 });
    return months.length === 2 && months[1]!.year === 2026 && months[1]!.month === 12;
  })(),
);
check(
  "monthsRequiredFor(Aug) does not list August twice",
  monthsRequiredFor({ year: 2026, month: 8 }).map((m) => m.month).join(",") === "8,7",
);

// =============================================================================
console.log("\n[S3-M] the view model, assembled from raw records");
// =============================================================================

{
  const JULY = buildMonthRecords(TEAM, {
    year: 2026,
    month: 7,
    weeks: FOUR_WEEKS,
    hms: {
      Alpha: { monthly: { net: 60, target: 90, recruitment: 2 }, weekly: [15, 15, 15, 15] },
      Bravo: { monthly: { net: 40, target: 90, recruitment: 1 }, weekly: [10, 10, 10, 10] },
    },
  });

  const AUGUST = buildMonthRecords(TEAM, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: {
      Alpha: { monthly: { net: 70, target: 100, recruitment: 3 }, weekly: [18, 18, 17, 17] },
      Bravo: { monthly: { net: 50, target: 90, recruitment: 1 }, weekly: [13, 13, 12, 12] },
    },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [JULY, AUGUST, SEPTEMBER], SEPTEMBER, 72),
  )!;

  check("the view model builds", model !== null);
  check("group figures match the direct calculation", model.group.totalNet === 270);
  check("group SHI is the eTrust figure for the SELECTED month", model.group.groupShiPct === 72);
  check("rankings come pre-computed", model.rankings.length === 4 && model.rankings[0]!.rank === 1);

  check(
    "group MoM compares September 270 against August 120",
    model.previousMonth.previousNetUnits === 120 && model.previousMonth.differenceUnits === 150,
  );
  check("...and it names August as the month compared", model.previousMonth.previousMonth?.month === 8);
  check("...with a real percentage", close(model.previousMonth.percentageChange, 125));

  const alphaMom = model.hmPreviousMonth[hmId(TEAM, "Alpha")]!;
  check("HM-level MoM: Alpha 76 against 70 is +6", alphaMom.differenceUnits === 6);

  const charlieMom = model.hmPreviousMonth[hmId(TEAM, "Charlie")]!;
  check(
    "an HM with no August record gets no comparison, not a +100%",
    !charlieMom.hasPreviousMonthData && charlieMom.percentageChange === null,
  );

  check("group QTD is Jul 100 + Aug 120 + Sep 270 = 490", model.qtd.netUnits === 490);
  check("the quarter to date is complete - all three months have records", model.qtd.isComplete);
  check("group QTD recruitment is 3 + 4 + 9 = 16", model.qtd.recruitment === 16);

  const alphaQtd = model.hmQtd[hmId(TEAM, "Alpha")]!;
  check("HM QTD: Alpha 60 + 70 + 76 = 206", alphaQtd.netUnits === 206);
  check("HM QTD recruitment: 2 + 3 + 4 = 9", alphaQtd.recruitment === 9);

  const charlieQtd = model.hmQtd[hmId(TEAM, "Charlie")]!;
  check(
    "an HM who only appears in September has 65 QTD and an incomplete quarter",
    charlieQtd.netUnits === 65 && !charlieQtd.isComplete && charlieQtd.missingMonths.length === 2,
  );

  check("nothing in the whole view model is NaN or Infinity", everyNumberFinite(model));
}

{
  // Previous month absent from the bundle entirely.
  const model = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [SEPTEMBER], SEPTEMBER, 72),
  )!;

  check(
    "with no previous month in the bundle, MoM reports no data",
    !model.previousMonth.hasPreviousMonthData && model.previousMonth.differenceUnits === null,
  );
  check("QTD still totals September alone", model.qtd.netUnits === 270);
  check("...and reports July and August missing", model.qtd.missingMonths.length === 2);
}

{
  // A previous month that exists but was never keyed in.
  const emptyAugust = buildMonthRecords(TEAM, { year: 2026, month: 8, weeks: FOUR_WEEKS, hms: {} });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [emptyAugust, SEPTEMBER], SEPTEMBER, 72),
  )!;

  check(
    "an empty previous month is 'no data', not a zero baseline",
    !model.previousMonth.hasPreviousMonthData && model.previousMonth.percentageChange === null,
  );
  check("August is not counted towards QTD", model.qtd.monthsWithData === 1);
}

check(
  "a bundle whose selected month is not in it returns null rather than guessing",
  buildMonthlyPerformanceViewModel({
    selectedMonthId: "missing",
    hms: rosterList(TEAM),
    months: [SEPTEMBER],
    groupShiPct: null,
  }) === null,
);

{
  // Group SHI belongs to the selected month only - it must not leak sideways.
  const august = buildMonthRecords(TEAM, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: { Alpha: { monthly: { net: 70, target: 100 } } },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [august, SEPTEMBER], SEPTEMBER, 72),
  )!;

  check("the selected month carries the group SHI", model.group.groupShiPct === 72);
  check(
    "and it is not the average of anything",
    model.group.groupShiPct === 72 && model.group.hms.some((hm) => hm.shiPct !== 72),
  );
}

// =============================================================================
console.log("\n[S3-N] no cross-month contamination");
// =============================================================================

{
  // The bundle hands every month's weekly rows to each month. Only the month's
  // own weeks may count.
  const roster = createRoster(["Alpha"]);

  const july = buildMonthRecords(roster, {
    year: 2026,
    month: 7,
    weeks: FOUR_WEEKS,
    hms: { Alpha: { monthly: { net: 40, target: 50 }, weekly: [10, 10, 10, 10] } },
  });

  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 20, target: 50 }, weekly: [20, null, null, null, null] } },
  });

  const inputs = buildHmMonthInputs({
    hms: rosterList(roster),
    weeks: september.weeks,
    monthly: september.monthly,
    // Deliberately contaminated with July's Key-In.
    weekly: [...september.weekly, ...july.weekly],
  });

  const hm = calculateHmMonthlyPerformance(inputs[0]!, september.weeks.map(toSalesWeekInput));

  check(
    "July's Key-In does not leak into September's total",
    hm.totalKeyIn === 20,
    `got ${hm.totalKeyIn}`,
  );
  check("only September's five weeks are modelled", hm.weeklyPerformance.length === 5);
}

{
  // The group weekly totals key on week id, so a reordered week list still
  // attributes each figure to the right column.
  const group = calculateOneMonth(TEAM, SEPTEMBER, 72);
  const weeks = SEPTEMBER.weeks.map(toSalesWeekInput);
  const reversed = [...weeks].reverse();

  const inOrder = calculateGroupWeeklyKeyIn(group.hms, weeks);
  const shuffled = calculateGroupWeeklyKeyIn(group.hms, reversed);

  check(
    "each week keeps its own units whatever order the weeks arrive in",
    shuffled.every((column) => {
      const original = inOrder.find((entry) => entry.weekId === column.weekId);

      return original?.keyInUnits === column.keyInUnits;
    }),
  );
  check(
    "W1 is still 68 units when the list is reversed",
    shuffled.find((column) => column.weekNumber === 1)?.keyInUnits === 68,
  );
}

{
  // HM-level MoM through the view model, for an HM missing the current month.
  const august = buildMonthRecords(TEAM, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: {
      Alpha: { monthly: { net: 70, target: 100 } },
      Bravo: { monthly: { net: 50, target: 90 } },
    },
  });

  const septemberPartial = buildMonthRecords(TEAM, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 76, target: 100 } } },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(TEAM, [august, septemberPartial], septemberPartial, null),
  )!;

  const bravo = model.hmPreviousMonth[hmId(TEAM, "Bravo")]!;

  check(
    "an HM with an August record but no September one is not reported as -100%",
    !bravo.hasCurrentMonthData &&
      bravo.previousNetUnits === 50 &&
      bravo.differenceUnits === null &&
      bravo.percentageChange === null,
  );

  const alpha = model.hmPreviousMonth[hmId(TEAM, "Alpha")]!;

  check(
    "the HM who does have both months still compares normally",
    alpha.hasCurrentMonthData && alpha.differenceUnits === 6,
  );
}

check(
  "sumKeyIn still ignores blanks (Stage 2 behaviour, unchanged)",
  sumKeyIn([20, null, 18, null]) === 38,
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
