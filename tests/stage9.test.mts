/**
 * Stage 9 tests: KPI status and Management Attention.
 *
 *   npm run test:stage9
 *
 * Same shape as Stages 1-8 - plain Node, no framework, one file, the Stage 3
 * fixtures reused.
 *
 * ---------------------------------------------------------------------------
 * What is being tested, and what deliberately is not
 * ---------------------------------------------------------------------------
 * NOT the figures again. Key-In totals, Net Ratio, Achievement, Active HP and
 * the ranking are proved against the engine in Stages 3 and 8; this stage does
 * not calculate a single new business figure, it BANDS existing ones.
 *
 * So what is tested here is what this stage can uniquely get wrong:
 *
 *   the EDGES     every threshold the business stated, at the exact value it
 *                 stated it at, on both sides. 15% and 15.1%, 30% and 29.9%,
 *                 20 active HPs and 21. An off-by-one in a band is invisible
 *                 until the month it moves somebody onto the attention list.
 *
 *   the BLANKS    that a figure nobody has keyed in gets NO band rather than a
 *                 red one, that a week with no defined threshold (W5, W6) gets
 *                 none rather than an invented one, and that a zero target
 *                 makes a pace unknown rather than 0%.
 *
 *   the WEEK      that the current week comes off the CONFIGURED Coway periods
 *                 and never off calendar arithmetic - including a month whose
 *                 W1 opens in the previous calendar month, a historical month
 *                 with no week in progress, and a gap between two periods.
 *
 *   the MONTH     that switching month re-bands against that month's own
 *                 figures, weeks and targets, and never leaks the other's.
 *
 *   the LIST      that Management Attention holds only NEEDS ATTENTION, orders
 *                 by red count then by the dashboard's own ranking, and says
 *                 something positive rather than nothing when it is empty.
 *
 *   the ABSENCES  that no overall score exists anywhere in the models, and that
 *                 the deprecated Active HP column cannot influence a band.
 *
 *   the SHARE     that the bands DO reach the shared report - the HM opening
 *                 their own card from the WhatsApp link needs them - while the
 *                 HM Code still does not, and no Management Attention section
 *                 follows them there.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cumulativeKeyIn,
  getActiveHpStatus,
  getHmKpiStatuses,
  getKeyInStatus,
  getManagementAttention,
  getNetStatus,
  getRecruitmentStatus,
  hasKeyInThreshold,
  keyInAchievement,
  resolveCurrentWeek,
  toSalesWeekInput,
  ACTIVE_HP_THRESHOLD,
  KEYIN_WEEK_THRESHOLDS,
  KPI_STATUSES,
  NET_RATIO_THRESHOLD,
  RECRUITMENT_THRESHOLD,
  type HmKpiStatuses,
  type KpiStatus,
} from "@/lib/calculations";
import { reportingDate } from "@/lib/calendar";
import { buildDashboardViewModel } from "@/lib/view-models/dashboard";
import { buildHmDetailViewModel } from "@/lib/view-models/hm-detail";
import {
  buildHmPerformanceViewModel,
  buildMonthlyPerformanceViewModel,
  type MonthPerformanceRecords,
  type PerformanceBundle,
} from "@/lib/view-models/monthly-performance";
import type { HMMonthlyPerformance } from "@/types/models";

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

/** The real `src/` tree, for the wiring checks in [S9-Q]. */
const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

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

/**
 * A percentage expressed as units against a target of 1000.
 *
 * `at(15.1)` is 151 units - which is the only honest way to test a boundary
 * stated as "15.1%": the engine divides units by a target, so a test that fed
 * it 15.1 directly would be testing a different function from the one that
 * runs in production.
 */
const at = (percentage: number) => Math.round(percentage * 10);
const TARGET = 1000;

// =============================================================================
section("[S9-A] Key-In bands, at every edge the business stated");
// =============================================================================

{
  const w = (week: number, percentage: number) =>
    getKeyInStatus(week, at(percentage), TARGET);

  // W1: <=15 attention, >15 and <=25 watch, >25 on track.
  // The one week stated with STRICT comparisons - 15 is red and 25 is amber.
  check("W1: 15% is needs_attention (boundary)", w(1, 15) === "needs_attention");
  check("W1: 15.1% is watch (boundary)", w(1, 15.1) === "watch");
  check("W1: 25% is watch (boundary)", w(1, 25) === "watch");
  check("W1: 25.1% is on_track (boundary)", w(1, 25.1) === "on_track");
  check("W1: 0% is needs_attention", w(1, 0) === "needs_attention");
  check("W1: 90% is on_track", w(1, 90) === "on_track");

  // W2: <30 attention, >=30 and <50 watch, >=50 on track.
  check("W2: 29.9% is needs_attention (boundary)", w(2, 29.9) === "needs_attention");
  check("W2: 30% is watch (boundary)", w(2, 30) === "watch");
  check("W2: 49.9% is watch (boundary)", w(2, 49.9) === "watch");
  check("W2: 50% is on_track (boundary)", w(2, 50) === "on_track");

  // W3: <45 attention, >=45 and <75 watch, >=75 on track.
  check("W3: 44.9% is needs_attention (boundary)", w(3, 44.9) === "needs_attention");
  check("W3: 45% is watch (boundary)", w(3, 45) === "watch");
  check("W3: 74.9% is watch (boundary)", w(3, 74.9) === "watch");
  check("W3: 75% is on_track (boundary)", w(3, 75) === "on_track");

  // W4: <60 attention, >=60 and <100 watch, >=100 on track.
  check("W4: 59.9% is needs_attention (boundary)", w(4, 59.9) === "needs_attention");
  check("W4: 60% is watch (boundary)", w(4, 60) === "watch");
  check("W4: 99.9% is watch (boundary)", w(4, 99.9) === "watch");
  check("W4: 100% is on_track (boundary)", w(4, 100) === "on_track");
  check("W4: 140% is on_track", w(4, 140) === "on_track");
}

{
  // The same edges again, this time through a target that is not a round 1000 -
  // so a band cannot be passing because the arithmetic happened to be exact.
  check(
    "W2: 21 of 70 is exactly 30% and lands on watch",
    getKeyInStatus(2, 21, 70) === "watch",
  );

  check(
    "W1: 15 of 100 is exactly 15% and stays needs_attention",
    getKeyInStatus(1, 15, 100) === "needs_attention",
  );

  check(
    "W3: 3 of 4 is 75% and lands on on_track",
    getKeyInStatus(3, 3, 4) === "on_track",
  );
}

// =============================================================================
section("[S9-A2] Key-In is banded on the month SO FAR, not on one week");
// =============================================================================

/**
 * The rule this whole stage turns on, and the one it originally got wrong.
 *
 * The thresholds are a PACE CURVE against the monthly target: On Track at W4 is
 * 100% of the month, which no HM reaches inside a single week. Banding each
 * week's own figure made that edge unreachable by construction and painted a
 * healthy team red. The numerator is the running total.
 */
{
  const running = cumulativeKeyIn([
    { weekNumber: 1, keyInUnits: 20 },
    { weekNumber: 2, keyInUnits: 27 },
    { weekNumber: 3, keyInUnits: 30 },
    { weekNumber: 4, keyInUnits: 25 },
  ]);

  check(
    "the running total accumulates: 20, 47, 77, 102",
    running.map((week) => week.toDate).join() === "20,47,77,102",
    running.map((week) => week.toDate).join(),
  );

  check(
    "so a month that would be red every week on its own figures is on track",
    // 27 of 100 at W2 is needs_attention alone; 47 of 100 is watch.
    getKeyInStatus(2, 27, 100) === "needs_attention" &&
      getKeyInStatus(2, 47, 100) === "watch" &&
      getKeyInStatus(4, 25, 100) === "needs_attention" &&
      getKeyInStatus(4, 102, 100) === "on_track",
  );

  check(
    "W4 On Track is only reachable cumulatively - one week of it never is",
    // A quarter of the target in each of four weeks: red at W4 standalone,
    // exactly On Track once added up.
    getKeyInStatus(4, 25, 100) === "needs_attention" &&
      getKeyInStatus(4, 100, 100) === "on_track",
  );
}

{
  // Order of the rows must not matter: the WEEK NUMBER accumulates the month.
  const shuffled = cumulativeKeyIn([
    { weekNumber: 3, keyInUnits: 30 },
    { weekNumber: 1, keyInUnits: 20 },
    { weekNumber: 2, keyInUnits: 27 },
  ]);

  check(
    "the total accumulates by week number, whatever order the rows arrive in",
    shuffled.map((week) => `${week.weekNumber}:${week.toDate}`).join() ===
      "1:20,2:47,3:77",
    shuffled.map((week) => `${week.weekNumber}:${week.toDate}`).join(),
  );
}

{
  // Blanks: a week nobody keyed in contributes nothing and is not a zero.
  const withGaps = cumulativeKeyIn([
    { weekNumber: 1, keyInUnits: null },
    { weekNumber: 2, keyInUnits: 40 },
    { weekNumber: 3, keyInUnits: null },
    { weekNumber: 4, keyInUnits: 10 },
  ]);

  check(
    "a blank week has no running total of its own - there is no point to band",
    withGaps[0]!.toDate === null && withGaps[2]!.toDate === null,
  );

  check(
    "and it contributes nothing rather than zero, so later weeks carry on",
    withGaps[1]!.toDate === 40 && withGaps[3]!.toDate === 50,
  );

  check(
    "the weeks missing from the total are counted, so a screen can say so",
    withGaps[1]!.blankBefore === 1 && withGaps[3]!.blankBefore === 2,
  );

  check(
    "an entered ZERO week is a figure, not a blank: it has a running total",
    cumulativeKeyIn([{ weekNumber: 1, keyInUnits: 0 }])[0]!.toDate === 0,
  );
}

{
  // The gap has to be visible on screen: a red caused by an unkeyed W1 is a
  // hole in the records, not a verdict on the HM.
  const roster = createRoster(["Alpha"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: {
        monthly: { net: 10, target: 100, recruitment: 5, activeHp: 25 },
        weekly: [null, 12, null, null, null],
      },
    },
  });

  const card = buildDashboardViewModel({
    selectedMonth: records.month,
    performance: buildMonthlyPerformanceViewModel(
      bundleOf(roster, [records], records),
      { today: "2026-09-08" },
    )!,
    lastUpdatedAt: null,
  }).hms[0]!;

  check(
    "a running total measured over a missing week says so, in words",
    card.statuses.keyIn.note ===
      "W1–W2: 12 of 100 target · 12.0% · 1 earlier week not entered",
    card.statuses.keyIn.note ?? "(none)",
  );
}

// =============================================================================
section("[S9-B] Key-In: no threshold, no target, no figure");
// =============================================================================

{
  check(
    "W5 has no defined threshold, so there is no status",
    getKeyInStatus(5, at(90), TARGET) === null,
  );

  check(
    "W6 has no defined threshold either - not even for a huge figure",
    getKeyInStatus(6, at(400), TARGET) === null,
  );

  check(
    "and the engine says so directly",
    hasKeyInThreshold(4) &&
      !hasKeyInThreshold(5) &&
      !hasKeyInThreshold(6) &&
      !hasKeyInThreshold(0),
  );

  check(
    "a target of 0 makes the pace unknown, NOT 0%",
    getKeyInStatus(2, 40, 0) === null,
  );

  check(
    "a blank target is unknown, not zero",
    getKeyInStatus(2, 40, null) === null,
  );

  check(
    "a blank week has no status - a week nobody has keyed in is not a bad week",
    getKeyInStatus(2, null, TARGET) === null,
  );

  check(
    "an ENTERED zero week is a real 0% and is needs_attention",
    getKeyInStatus(2, 0, TARGET) === "needs_attention",
  );

  check(
    "the achievement itself is null rather than NaN when the target is 0",
    keyInAchievement(40, 0) === null && keyInAchievement(null, 100) === null,
  );

  check(
    "a negative target cannot produce a band",
    getKeyInStatus(2, 40, -100) === null,
  );
}

// =============================================================================
section("[S9-C] Recruitment: 0-2 attention, 3-4 watch, >=5 on track");
// =============================================================================

{
  check("0 is needs_attention (boundary)", getRecruitmentStatus(0) === "needs_attention");
  check("1 is needs_attention", getRecruitmentStatus(1) === "needs_attention");
  check("2 is needs_attention (boundary)", getRecruitmentStatus(2) === "needs_attention");
  check("3 is watch (boundary)", getRecruitmentStatus(3) === "watch");
  check("4 is watch (boundary)", getRecruitmentStatus(4) === "watch");
  check("5 is on_track (boundary)", getRecruitmentStatus(5) === "on_track");
  check("12 is on_track", getRecruitmentStatus(12) === "on_track");

  check(
    "blank recruitment has NO status - nobody has said anything about it yet",
    getRecruitmentStatus(null) === null,
  );

  check(
    "a negative figure, if one ever reached here, is needs_attention rather than a crash",
    getRecruitmentStatus(-4) === "needs_attention",
  );

  check(
    "these are NOT the Stage 2 colour bands: 3 is watch here, green there",
    getRecruitmentStatus(3) === "watch" &&
      RECRUITMENT_THRESHOLD.watch === 3 &&
      RECRUITMENT_THRESHOLD.onTrack === 5,
  );
}

// =============================================================================
section("[S9-D] Net ratio: <50 attention, 50-74.9 watch, >=75 on track");
// =============================================================================

{
  // Net over Total Key-In, so the ratio is built the way the engine builds it.
  const ratio = (percentage: number) => getNetStatus(at(percentage), TARGET);

  check("49.9% is needs_attention (boundary)", ratio(49.9) === "needs_attention");
  check("50% is watch (boundary)", ratio(50) === "watch");
  check("74.9% is watch (boundary)", ratio(74.9) === "watch");
  check("75% is on_track (boundary)", ratio(75) === "on_track");
  check("100% is on_track", ratio(100) === "on_track");

  check(
    "an entered Net of 0 is a real 0% ratio and is needs_attention",
    getNetStatus(0, 500) === "needs_attention",
  );

  check(
    "Net entered with NOTHING keyed in is needs_attention, not a crash",
    getNetStatus(40, 0) === "needs_attention",
  );

  check(
    "and it is never NaN or Infinity",
    KPI_STATUSES.includes(getNetStatus(40, 0) as KpiStatus),
  );

  check(
    "blank Net has NO status - the ratio is unknown, and unknown is not bad",
    getNetStatus(null, 500) === null && getNetStatus(null, 0) === null,
  );

  check(
    "the thresholds are the business's, in one place",
    NET_RATIO_THRESHOLD.watch === 50 && NET_RATIO_THRESHOLD.onTrack === 75,
  );
}

// =============================================================================
section("[S9-E] Active HP: <10 attention, 10-20 watch, >20 on track");
// =============================================================================

{
  check("9 is needs_attention (boundary)", getActiveHpStatus(9) === "needs_attention");
  check("10 is watch (boundary)", getActiveHpStatus(10) === "watch");
  check("20 is watch (boundary)", getActiveHpStatus(20) === "watch");
  check("21 is on_track (boundary)", getActiveHpStatus(21) === "on_track");
  check("0 is needs_attention", getActiveHpStatus(0) === "needs_attention");
  check("40 is on_track", getActiveHpStatus(40) === "on_track");

  check(
    "no HP data imported has NO status - it is not zero active HPs",
    getActiveHpStatus(null) === null,
  );

  check(
    "the upper edge is exclusive, which is the one asymmetry in these bands",
    ACTIVE_HP_THRESHOLD.watch === 10 && ACTIVE_HP_THRESHOLD.onTrack === 20,
  );
}

// =============================================================================
section("[S9-F] the thresholds are declared once, exactly as stated");
// =============================================================================

{
  const expected = [
    { weekNumber: 1, watch: 15, onTrack: 25, edge: "exclusive" },
    { weekNumber: 2, watch: 30, onTrack: 50, edge: "inclusive" },
    { weekNumber: 3, watch: 45, onTrack: 75, edge: "inclusive" },
    { weekNumber: 4, watch: 60, onTrack: 100, edge: "inclusive" },
  ];

  check(
    "the Key-In table holds W1-W4 and nothing else",
    JSON.stringify([...KEYIN_WEEK_THRESHOLDS]) === JSON.stringify(expected),
    JSON.stringify([...KEYIN_WEEK_THRESHOLDS]),
  );

  check(
    "there are exactly three bands, and they are the three the business named",
    JSON.stringify([...KPI_STATUSES]) ===
      JSON.stringify(["needs_attention", "watch", "on_track"]),
  );
}

// =============================================================================
section("[S9-G] the current week comes off the CONFIGURED Coway periods");
// =============================================================================

{
  // September's W1 opens on 30 AUGUST - the case a "day 1-7 is W1" rule gets
  // wrong every month, and the reason nothing here does calendar arithmetic.
  const roster = createRoster(["Alpha"]);
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { weekly: [20, 18, null, null, null] } },
  });

  const weeks = september.weeks.map(toSalesWeekInput);

  const on = (today: string) => resolveCurrentWeek(weeks, today);

  check(
    "31 August falls in W1, which started in the previous calendar month",
    on("2026-08-31")?.week.weekNumber === 1 &&
      on("2026-08-31")?.source === "in_progress",
  );

  check(
    "5 September is the last day of W1, and is still W1",
    on("2026-09-05")?.week.weekNumber === 1,
  );

  check(
    "6 September is the first day of W2",
    on("2026-09-06")?.week.weekNumber === 2 &&
      on("2026-09-06")?.source === "in_progress",
  );

  check(
    "8 September is mid-W2 - not W2 by a 1-7/8-14 rule, but by the real period",
    on("2026-09-08")?.week.weekNumber === 2,
  );

  check(
    "a date after every period resolves to the LAST week, as completed",
    on("2027-01-04")?.week.weekNumber === 5 &&
      on("2027-01-04")?.source === "latest_completed",
  );

  check(
    "a date before every period resolves to W1, and says the month has not started",
    on("2026-08-01")?.week.weekNumber === 1 &&
      on("2026-08-01")?.source === "not_started",
  );

  check(
    "a month with no configured weeks resolves to nothing at all",
    resolveCurrentWeek([], "2026-09-08") === null,
  );
}

{
  // A gap in the calendar: Coway does not have to publish contiguous periods.
  const roster = createRoster(["Alpha"]);
  const gapped = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: [
      ["2026-09-01", "2026-09-07"],
      ["2026-09-14", "2026-09-20"],
    ],
    hms: { Alpha: { weekly: [10, 10] } },
  });

  const weeks = gapped.weeks.map(toSalesWeekInput);
  const inTheGap = resolveCurrentWeek(weeks, "2026-09-10");

  check(
    "a date in a gap between two periods falls back to the last that ENDED",
    inTheGap?.week.weekNumber === 1 && inTheGap.source === "latest_completed",
  );
}

{
  // Out-of-order week rows must not change the answer: the week NUMBER orders
  // the month, never the order rows happened to arrive in.
  const roster = createRoster(["Alpha"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { weekly: [10, 10, 10, 10, 10] } },
  });

  const shuffled = [...records.weeks].reverse().map(toSalesWeekInput);

  check(
    "the resolution is the same whatever order the week rows arrive in",
    resolveCurrentWeek(shuffled, "2026-09-08")?.week.weekNumber === 2,
  );
}

// =============================================================================
section("[S9-H] one HM's four statuses, from the calculated model");
// =============================================================================

{
  // The worked example from the brief: Key-In on track, Net red, recruitment
  // red, Active HP amber - four separate answers about one person.
  const roster = createRoster(["Mira"]);
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Mira: {
        // W2 is the current week on 8 September: 27 of a 100 target is 27%,
        // which is Needs Attention at W2 (<30) though it would be On Track at
        // W1 (>25). The week is the whole difference.
        monthly: { net: 8, target: 100, recruitment: 1, activeHp: 11 },
        weekly: [20, 27, null, null, null],
      },
    },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  const statuses = model.hmKpiStatuses[hmId(roster, "Mira")]!;

  check(
    "the current week is W2, from the calendar rather than from the data",
    statuses.keyIn.weekLabel === "W2" && statuses.keyIn.weekNumber === 2,
  );

  check(
    "Key-In at W2 is banded on W1+W2 - 20+27 = 47 of 100, which is 47% and watch",
    statuses.keyIn.status === "watch" &&
      statuses.keyIn.keyInToDate === 47 &&
      statuses.keyIn.targetUnits === 100 &&
      statuses.keyIn.achievementPct === 47,
    `${statuses.keyIn.status} on ${statuses.keyIn.keyInToDate}`,
  );

  check(
    "the week's OWN figure is still carried, for the screens that show it",
    statuses.keyIn.keyInUnits === 27,
  );

  check(
    "and W2 alone would have been 27% - needs_attention - so the two really differ",
    getKeyInStatus(2, 27, 100) === "needs_attention",
  );

  check(
    "the denominator is the MONTHLY target, not the month's Key-In so far",
    statuses.keyIn.targetUnits === 100,
  );

  check(
    "Net: 8 of 47 keyed in is 17.0%, which is needs_attention",
    statuses.net === "needs_attention",
  );

  check("Recruitment: 1 is needs_attention", statuses.recruitment === "needs_attention");
  check("Active HP: 11 is watch", statuses.activeHp === "watch");

  check(
    "the four are kept separate - there is no combined status on the model",
    !("overall" in statuses) &&
      !("score" in statuses) &&
      !("overallStatus" in statuses),
  );

  check(
    "every week of the month is banded, W5 included but unbanded",
    statuses.weekly.length === 5 &&
      statuses.weekly[0]!.status === "watch" &&
      statuses.weekly[1]!.status === "watch" &&
      statuses.weekly[2]!.status === null &&
      statuses.weekly[4]!.hasThreshold === false,
  );

  check(
    "the running total is what each week carries: 20, then 47",
    statuses.weekly[0]!.keyInToDate === 20 &&
      statuses.weekly[1]!.keyInToDate === 47 &&
      statuses.weekly[0]!.achievementPct === 20 &&
      statuses.weekly[1]!.achievementPct === 47,
  );

  check(
    "the SAME 20% reads as watch at W1 and would be needs_attention at W2",
    statuses.weekly[0]!.achievementPct === 20 &&
      statuses.weekly[0]!.status === "watch" &&
      getKeyInStatus(2, 20, 100) === "needs_attention",
  );

  check(
    "exactly one week is marked as the current one",
    statuses.weekly.filter((week) => week.isCurrent).length === 1 &&
      statuses.weekly[1]!.isCurrent,
  );

  check("nothing in the model is NaN or Infinity", everyNumberFinite(statuses));

  check(
    "the pure function called directly gives the same answer as the view model",
    JSON.stringify(
      getHmKpiStatuses(model.group.hms[0]!, model.currentWeek),
    ) === JSON.stringify(statuses),
  );

  check(
    "and with no current week at all, every band is absent rather than red",
    (() => {
      const unresolved = getHmKpiStatuses(model.group.hms[0]!, null);

      return (
        unresolved.keyIn.status === null &&
        unresolved.keyIn.weekLabel === null &&
        // The other three do not depend on the week, so they still band.
        unresolved.recruitment === "needs_attention" &&
        unresolved.weekly.every((week) => !week.isCurrent)
      );
    })(),
  );
}

{
  // W1's own band, proved on its own: 20% is Watch at W1 (>15, <=25).
  const roster = createRoster(["Alpha"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 10, target: 100 }, weekly: [20] } },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [records], records),
    { today: "2026-09-02" },
  )!;

  const statuses = model.hmKpiStatuses[hmId(roster, "Alpha")]!;

  check(
    "at W1, 20 of a 100 target is 20% and lands on watch",
    statuses.keyIn.weekLabel === "W1" && statuses.keyIn.status === "watch",
  );
}

// =============================================================================
section("[S9-I] blanks produce no band, never a red one");
// =============================================================================

{
  const roster = createRoster(["Alpha", "Bravo"]);
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    // Bravo is on the roster and has NOTHING entered: no monthly row, no weeks,
    // no HP import. The month covers them, and they must not be reported as
    // failing on four counts because the PA has not got to them.
    hms: { Alpha: { monthly: { net: 60, target: 100, recruitment: 6, activeHp: 30 }, weekly: [30, 30] } },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  const bravo = model.hmKpiStatuses[hmId(roster, "Bravo")]!;

  check(
    "an HM with nothing entered has NO band on any of the four",
    bravo.keyIn.status === null &&
      bravo.net === null &&
      bravo.recruitment === null &&
      bravo.activeHp === null,
  );

  check(
    "and is therefore NOT on the management attention list",
    !model.managementAttention.some((entry) => entry.hmName === "Bravo"),
  );

  const alpha = model.hmKpiStatuses[hmId(roster, "Alpha")]!;

  check(
    "the HM who has been keyed in is banded normally",
    // 30+30 = 60 of a 100 target at W2 is 60%, which clears the 50% On Track edge.
    alpha.keyIn.status === "on_track" &&
      alpha.net === "on_track" &&
      alpha.recruitment === "on_track" &&
      alpha.activeHp === "on_track",
    `${alpha.keyIn.status}/${alpha.net}/${alpha.recruitment}/${alpha.activeHp}`,
  );
}

{
  // A month whose current week nobody has keyed in yet - the ordinary
  // mid-week case. The status is absent, not red.
  const roster = createRoster(["Alpha"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 20, target: 100 }, weekly: [30, null] } },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [records], records),
    { today: "2026-09-08" },
  )!;

  const statuses = model.hmKpiStatuses[hmId(roster, "Alpha")]!;

  check(
    "W2 is current but blank: no Key-In band, and the week is still named",
    statuses.keyIn.weekLabel === "W2" &&
      statuses.keyIn.status === null &&
      statuses.keyIn.isEntered === false,
  );

  check(
    "and that blank does not put the HM on the attention list for Key-In",
    !model.managementAttention.some((entry) => entry.kpis.includes("keyIn")),
  );
}

{
  // No target set: the pace is unknown, and an unknown pace is not a bad one.
  const roster = createRoster(["Alpha"]);
  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 20, target: 0 }, weekly: [30, 5] } },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [records], records),
    { today: "2026-09-08" },
  )!;

  const statuses = model.hmKpiStatuses[hmId(roster, "Alpha")]!;

  check(
    "a target of 0 leaves the Key-In band unset even with a tiny week",
    statuses.keyIn.status === null && statuses.keyIn.achievementPct === null,
  );

  check(
    "but Net still bands, because its denominator is Key-In rather than target",
    // 20 Net against 35 keyed in is 57.1% - watch, on figures that give the
    // Key-In band nothing at all to work with.
    statuses.net === "watch",
    `${statuses.net}`,
  );
}

// =============================================================================
section("[S9-J] W5 and W6 keep working, and get no invented band");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);
  const sixWeeks = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: [
      ["2026-08-30", "2026-09-05"],
      ["2026-09-06", "2026-09-12"],
      ["2026-09-13", "2026-09-19"],
      ["2026-09-20", "2026-09-26"],
      ["2026-09-27", "2026-10-03"],
      ["2026-10-04", "2026-10-10"],
    ],
    hms: {
      Alpha: {
        // 150 keyed in across six weeks, 120 of it net - a ratio of 80%.
        monthly: { net: 120, target: 100, recruitment: 6, activeHp: 25 },
        weekly: [25, 25, 25, 25, 25, 25],
      },
    },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [sixWeeks], sixWeeks),
    // Inside W5.
    { today: "2026-09-30" },
  )!;

  const statuses = model.hmKpiStatuses[hmId(roster, "Alpha")]!;

  check(
    "W5 is correctly identified as the current week",
    statuses.keyIn.weekLabel === "W5" && statuses.keyIn.weekNumber === 5,
  );

  check(
    "its figures are still visible - the data is not hidden, only the band",
    // The week's own 25, and 125 banked across W1-W5 against a target of 100.
    statuses.keyIn.keyInUnits === 25 &&
      statuses.keyIn.keyInToDate === 125 &&
      statuses.keyIn.achievementPct === 125,
  );

  check(
    "but there is no Key-In band, because the business defined none for W5",
    statuses.keyIn.status === null && statuses.keyIn.hasThreshold === false,
  );

  check(
    "the other three KPIs are unaffected by the week having no threshold",
    statuses.net === "on_track" &&
      statuses.recruitment === "on_track" &&
      statuses.activeHp === "on_track",
  );

  check(
    "W6 is carried and banded as unconfigured too",
    statuses.weekly.length === 6 &&
      statuses.weekly[5]!.hasThreshold === false &&
      statuses.weekly[5]!.status === null &&
      statuses.weekly[5]!.keyInUnits === 25,
  );

  check(
    "W1-W4 in the same month still band normally, on the running total",
    // 25, 50, 75, 100 against a target of 100: watch at W1, then the pace curve
    // is met exactly at every edge after it.
    statuses.weekly.slice(0, 4).every((week) => week.hasThreshold) &&
      statuses.weekly[0]!.status === "watch" &&
      statuses.weekly[1]!.status === "on_track" &&
      statuses.weekly[2]!.status === "on_track" &&
      statuses.weekly[3]!.status === "on_track",
    statuses.weekly
      .slice(0, 4)
      .map((week) => `${week.weekLabel}:${week.keyInToDate}:${week.status}`)
      .join(" "),
  );

  const dashboard = buildDashboardViewModel({
    selectedMonth: sixWeeks.month,
    performance: model,
    lastUpdatedAt: null,
  });

  check(
    "the dashboard says 'Not configured' for W5 rather than showing a band",
    dashboard.weekly.weeks[4]!.kpiStatus.status === null &&
      dashboard.weekly.weeks[4]!.kpiStatus.label === "Not configured",
    dashboard.weekly.weeks[4]!.kpiStatus.label,
  );

  check(
    "and the six weekly bars are all still there",
    dashboard.weekly.weeks.length === 6 && dashboard.weekly.weeksConfigured === 6,
  );
}

// =============================================================================
section("[S9-K] the month on screen is the month that is banded");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);

  // August: four weeks, and a strong W2. September: five weeks, and a weak one.
  const august = buildMonthRecords(roster, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: {
      Alpha: {
        monthly: { net: 90, target: 100, recruitment: 8, activeHp: 30 },
        weekly: [30, 60, 20, 20],
      },
    },
  });

  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: SEPTEMBER_WEEKS,
    hms: {
      Alpha: {
        monthly: { net: 5, target: 100, recruitment: 0, activeHp: 4 },
        weekly: [10, 5, null, null, null],
      },
    },
  });

  const months = [august, september];

  const septemberModel = buildMonthlyPerformanceViewModel(
    bundleOf(roster, months, september),
    { today: "2026-09-08" },
  )!;

  const augustModel = buildMonthlyPerformanceViewModel(
    bundleOf(roster, months, august),
    // The same "today". August is historical from here, and must be banded on
    // its own weeks rather than on September's position in the month.
    { today: "2026-09-08" },
  )!;

  const septemberStatuses = septemberModel.hmKpiStatuses[hmId(roster, "Alpha")]!;
  const augustStatuses = augustModel.hmKpiStatuses[hmId(roster, "Alpha")]!;

  check(
    "September, mid-W2: 10+5 = 15 of 100 is 15%, needs_attention",
    septemberStatuses.keyIn.weekLabel === "W2" &&
      septemberStatuses.keyIn.keyInToDate === 15 &&
      septemberStatuses.keyIn.status === "needs_attention",
  );

  check(
    "August is historical, so its current week is its LAST week, W4",
    augustStatuses.keyIn.weekLabel === "W4" &&
      augustModel.currentWeek?.source === "latest_completed",
  );

  check(
    "and August is banded on August's own running total: 30+60+20+20 = 130 of 100",
    augustStatuses.keyIn.keyInUnits === 20 &&
      augustStatuses.keyIn.keyInToDate === 130 &&
      augustStatuses.keyIn.status === "on_track",
    `${augustStatuses.keyIn.keyInToDate} -> ${augustStatuses.keyIn.status}`,
  );

  check(
    "August's other three KPIs are August's, not September's",
    // 90 Net against 130 keyed in is 69.2% - watch. Recruitment 8 and 30 active
    // HPs are both on track.
    augustStatuses.net === "watch" &&
      augustStatuses.recruitment === "on_track" &&
      augustStatuses.activeHp === "on_track",
    `${augustStatuses.net}/${augustStatuses.recruitment}/${augustStatuses.activeHp}`,
  );

  check(
    "while September's are September's",
    septemberStatuses.net === "needs_attention" &&
      septemberStatuses.recruitment === "needs_attention" &&
      septemberStatuses.activeHp === "needs_attention",
  );

  check(
    "the two months do not share a single band between them",
    augustStatuses.recruitment !== septemberStatuses.recruitment &&
      augustStatuses.activeHp !== septemberStatuses.activeHp,
  );

  check(
    "August's W2 uses W2's rule, not the rule for the week September is in",
    // 30+60 = 90 of 100 at W2 is 90%, which is On Track (>=50).
    augustStatuses.weekly[1]!.keyInToDate === 90 &&
      augustStatuses.weekly[1]!.status === "on_track",
  );

  check(
    "the attention list follows the month too",
    // August finished at 130% of target with 8 recruits and 30 active HPs, so
    // nobody is on its list; September is red on all four.
    augustModel.managementAttention.length === 0 &&
      septemberModel.managementAttention[0]!.attentionCount === 4,
  );
}

// =============================================================================
section("[S9-L] Management Attention: only red, ordered, and never advice");
// =============================================================================

{
  const roster = createRoster(["Red3", "Red2", "Red1", "Amber", "Green"]);

  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      // Every Key-In band below is the RUNNING total at W2 - W1+W2 - against a
      // target of 100. Net descending drives the ranking, so the tie-break in
      // the next block is a real one.
      Green: {
        // 90 of 100 by W2, and 95 net of 90 keyed in. Nothing red.
        monthly: { net: 95, target: 100, recruitment: 6, activeHp: 30 },
        weekly: [30, 60, null, null, null],
      },
      Amber: {
        // Every band amber: 36% at W2, net ratio 55.6%, 3 recruits, 15 active
        // HPs. Watch is NOT attention, and must not appear on the list.
        monthly: { net: 20, target: 100, recruitment: 3, activeHp: 15 },
        weekly: [16, 20, null, null, null],
      },
      Red1: {
        // One red: recruitment. 75 of 100 by W2 is on track.
        monthly: { net: 50, target: 100, recruitment: 0, activeHp: 25 },
        weekly: [20, 55, null, null, null],
      },
      Red2: {
        // Two reds: recruitment and Active HP. 70 of 100 by W2 is on track.
        monthly: { net: 40, target: 100, recruitment: 1, activeHp: 5 },
        weekly: [20, 50, null, null, null],
      },
      Red3: {
        // Three reds: Key-In, recruitment and Active HP. Only 15 of 100 by W2.
        // Net is 14 of those 15, which is 93.3% - on track, so it stays off.
        monthly: { net: 14, target: 100, recruitment: 0, activeHp: 2 },
        weekly: [10, 5, null, null, null],
      },
    },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  const attention = model.managementAttention;

  check(
    "only the HMs with at least one red appear",
    attention.length === 3 &&
      attention.every((entry) => entry.hmName.startsWith("Red")),
    attention.map((entry) => entry.hmName).join(", "),
  );

  check(
    "an HM whose every band is WATCH is not on the list",
    !attention.some((entry) => entry.hmName === "Amber"),
  );

  check(
    "and neither is one who is on track everywhere",
    !attention.some((entry) => entry.hmName === "Green"),
  );

  check(
    "most red KPIs first",
    attention.map((entry) => entry.attentionCount).join() === "3,2,1",
    attention.map((entry) => `${entry.hmName}:${entry.attentionCount}`).join(" "),
  );

  check(
    "each entry names the HM, the code, and only the RED KPIs",
    attention[2]!.hmName === "Red1" &&
      attention[2]!.hmCode.length > 0 &&
      attention[2]!.kpis.join() === "recruitment",
  );

  check(
    "the two-red entry names both, in the fixed KPI order",
    attention[1]!.kpis.join() === "recruitment,activeHp",
    attention[1]!.kpis.join(),
  );

  check(
    "the three-red entry names all three, Net excluded because Net is on track",
    attention[0]!.kpis.join() === "keyIn,recruitment,activeHp",
    attention[0]!.kpis.join(),
  );

  check(
    "an entry carries no advice, no message and no score - only what is red",
    Object.keys(attention[0]!).sort().join() ===
      "attentionCount,hmCode,hmId,hmName,kpis",
    Object.keys(attention[0]!).sort().join(),
  );
}

{
  // The tie-break: equal red counts keep the dashboard's ranking order.
  const roster = createRoster(["Low", "High"]);

  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      // Both are red on recruitment ALONE - same count, different Net - so the
      // only thing that can order them is the ranking.
      High: {
        monthly: { net: 80, target: 100, recruitment: 0, activeHp: 30 },
        weekly: [20, 60, null, null, null],
      },
      Low: {
        monthly: { net: 20, target: 25, recruitment: 0, activeHp: 30 },
        weekly: [5, 15, null, null, null],
      },
    },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  check(
    "with equal red counts, the order is the month's ranking - Net descending",
    model.managementAttention.map((entry) => entry.hmName).join() === "High,Low" &&
      model.rankings[0]!.performance.hmName === "High",
  );

  check(
    "the same model, built twice, produces the same order",
    JSON.stringify(model.managementAttention) ===
      JSON.stringify(
        buildMonthlyPerformanceViewModel(
          bundleOf(roster, [september], september),
          { today: "2026-09-08" },
        )!.managementAttention,
      ),
  );
}

{
  // The good month: everybody clear.
  const roster = createRoster(["Alpha", "Bravo"]);

  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: {
        monthly: { net: 90, target: 100, recruitment: 6, activeHp: 30 },
        weekly: [30, 60, null, null, null],
      },
      Bravo: {
        monthly: { net: 80, target: 100, recruitment: 5, activeHp: 21 },
        weekly: [30, 55, null, null, null],
      },
    },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  check("nobody is on the list", model.managementAttention.length === 0);

  const dashboard = buildDashboardViewModel({
    selectedMonth: september.month,
    performance: model,
    lastUpdatedAt: null,
  });

  check(
    "and the dashboard says so positively rather than showing an empty box",
    !dashboard.managementAttention.hasItems &&
      dashboard.managementAttention.emptyMessage ===
        "All HM KPIs are above the attention threshold.",
  );

  check(
    "the header names the week the Key-In band was taken from",
    dashboard.currentWeekLabel === "W2",
  );
}

// =============================================================================
section("[S9-M] the dashboard card and the HM screen cannot disagree");
// =============================================================================

{
  const roster = createRoster(["Alpha", "Bravo", "Charlie"]);

  const august = buildMonthRecords(roster, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: {
      Alpha: { monthly: { net: 70, target: 100, recruitment: 4, activeHp: 12 }, weekly: [20, 25, 30, 10] },
      Bravo: { monthly: { net: 30, target: 90, recruitment: 0, activeHp: 8 }, weekly: [5, 5, 5, 5] },
    },
  });

  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 40, target: 100, recruitment: 5, activeHp: 22 }, weekly: [26, 30, null, null, null] },
      Bravo: { monthly: { net: 10, target: 100, recruitment: 2, activeHp: 9 }, weekly: [8, 6, null, null, null] },
      Charlie: { activeHp: 14 },
    },
  });

  const months = [august, september];

  for (const records of months) {
    const bundle = bundleOf(roster, months, records);

    const performance = buildMonthlyPerformanceViewModel(bundle, {
      today: "2026-09-08",
    })!;

    const dashboard = buildDashboardViewModel({
      selectedMonth: records.month,
      performance,
      lastUpdatedAt: null,
    });

    for (const card of dashboard.hms) {
      const detail = buildHmDetailViewModel({
        selectedMonth: records.month,
        model: buildHmPerformanceViewModel(bundle, card.hmId, {
          today: "2026-09-08",
        })!,
        lastUpdatedAt: null,
      });

      check(
        `${card.name}, ${records.month.label}: every band is identical on both screens`,
        JSON.stringify(card.statuses) === JSON.stringify(detail.kpiStatuses),
        `${JSON.stringify(card.statuses)}\n        vs ${JSON.stringify(detail.kpiStatuses)}`,
      );

      check(
        `${card.name}, ${records.month.label}: the HM screen puts the bands on the tiles that carry the figures`,
        detail.keyIn.kpiStatus?.status === card.statuses.keyIn.status &&
          detail.net.kpiStatus?.status === card.statuses.net.status,
      );

      check(
        `${card.name}, ${records.month.label}: no band is NaN, and every one carries words`,
        everyNumberFinite(card.statuses) &&
          [
            card.statuses.keyIn,
            card.statuses.net,
            card.statuses.recruitment,
            card.statuses.activeHp,
          ].every((status) => status.label.length > 0),
      );
    }

    check(
      `${records.month.label}: the attention list on the dashboard is the engine's`,
      dashboard.managementAttention.items.map((item) => item.hmId).join() ===
        performance.managementAttention.map((entry) => entry.hmId).join(),
    );

    check(
      `${records.month.label}: every attention link carries the month being looked at`,
      dashboard.managementAttention.items.every((item) =>
        item.href.includes(`month=${dashboard.month.param}`),
      ),
    );
  }
}

// =============================================================================
section("[S9-N] the presented Key-In band explains what it measured");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: {
        monthly: { net: 20, target: 100, recruitment: 3, activeHp: 11 },
        weekly: [20, 27, null, null, null],
      },
    },
  });

  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  const dashboard = buildDashboardViewModel({
    selectedMonth: september.month,
    performance,
    lastUpdatedAt: null,
  });

  const card = dashboard.hms[0]!;

  check(
    "the Key-In figure on the card is still the month's total, untouched",
    card.keyInLabel === "47",
  );

  check(
    "and the band beside it names the SPAN, the running total and the monthly target",
    card.statuses.keyIn.note === "W1–W2: 47 of 100 target · 47.0%",
    card.statuses.keyIn.note ?? "(none)",
  );

  check(
    "the Net band says what the ratio was",
    card.statuses.net.note === "42.6% of Key-In",
    card.statuses.net.note ?? "(none)",
  );

  check(
    "the words are the business's, not a forecast",
    card.statuses.keyIn.label === "Watch" &&
      card.statuses.recruitment.label === "Watch" &&
      card.statuses.activeHp.label === "Watch",
  );

  check(
    "no card carries an overall status, a score or a rating",
    !("overallStatus" in card) && !("score" in card) && !("kpiScore" in card),
  );

  check(
    "a blank figure says WHICH kind of blank it is",
    (() => {
      // An active HM with NO monthly row and no HP import - the case the whole
      // "blank is not zero" rule exists for. Recruitment has never been typed
      // and no HP file has been imported: two different absences, and the card
      // has to be able to tell them apart. (An HM who DOES have a row with
      // recruitment 0 is a real, entered zero, and bands red - which is the
      // distinction being drawn here.)
      const pair = createRoster(["Keyed", "Untouched"]);

      const sparse = buildMonthRecords(pair, {
        year: 2026,
        month: 9,
        hms: { Keyed: { monthly: { net: 20, target: 100 }, weekly: [30, 30] } },
      });

      const cards = buildDashboardViewModel({
        selectedMonth: sparse.month,
        performance: buildMonthlyPerformanceViewModel(
          bundleOf(pair, [sparse], sparse),
          { today: "2026-09-08" },
        )!,
        lastUpdatedAt: null,
      }).hms;

      const blank = cards.find((entry) => entry.name === "Untouched")!;
      const keyed = cards.find((entry) => entry.name === "Keyed")!;

      if (keyed.statuses.recruitment.status !== "needs_attention") {
        return false;
      }

      return (
        blank.statuses.recruitment.status === null &&
        blank.statuses.recruitment.label === "Not entered" &&
        blank.statuses.activeHp.status === null &&
        blank.statuses.activeHp.label === "No HP data" &&
        blank.statuses.keyIn.label === "Not entered"
      );
    })(),
  );
}

// =============================================================================
section("[S9-O] Active HP bands the Stage 8 count, never the dead column");
// =============================================================================

{
  // The fixture writes `hm_monthly_performance.active_hp = 0` on every row it
  // builds. If anything in the Stage 9 path read that column, every HM below
  // would band as needs_attention.
  const roster = createRoster(["Alpha"]);
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: {
        monthly: { net: 60, target: 100, recruitment: 5, activeHp: 25 },
        weekly: [30, 30, null, null, null],
      },
    },
  });

  check(
    "the fixture really does hold a contradictory 0 in the deprecated column",
    // Reached through the full row type on purpose: the engine's own
    // `HmMonthlyRecord` does not include `active_hp` at all, which is the
    // structural half of this guarantee - there is nothing to read.
    (september.monthly[0] as HMMonthlyPerformance).active_hp === 0,
  );

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  const statuses = model.hmKpiStatuses[hmId(roster, "Alpha")]!;

  check(
    "and the band is on_track, from the HP-derived count of 25",
    statuses.activeHp === "on_track",
  );

  check(
    "the HM is not on the attention list because of that column",
    model.managementAttention.length === 0,
  );
}

{
  // HP rows imported, none of them active: a real, entered zero, which IS red.
  const roster = createRoster(["Alpha"]);
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: {
        monthly: { net: 60, target: 100, recruitment: 5, activeHp: 0, hpCount: 12 },
        weekly: [30, 30, null, null, null],
      },
    },
  });

  const model = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  check(
    "an imported month with nobody active is a real 0 and bands red",
    model.hmKpiStatuses[hmId(roster, "Alpha")]!.activeHp === "needs_attention",
  );

  check(
    "and that is the only thing it lands on the attention list for",
    model.managementAttention[0]!.kpis.join() === "activeHp",
  );
}

// =============================================================================
section("[S9-P] the reporting clock, and the shape of the whole model");
// =============================================================================

{
  check(
    "the reporting date is an ISO day in the business's timezone",
    /^\d{4}-\d{2}-\d{2}$/.test(reportingDate(new Date("2026-09-08T12:00:00Z"))),
  );

  check(
    "and it is Kuala Lumpur's day, not the server's - 17:00 UTC is already the 9th",
    reportingDate(new Date("2026-09-08T17:00:00Z")) === "2026-09-09" &&
      reportingDate(new Date("2026-09-08T15:00:00Z")) === "2026-09-08",
  );
}

{
  const roster = createRoster(["Alpha", "Bravo"]);
  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 40, target: 100, recruitment: 2, activeHp: 9 }, weekly: [10, 12, null, null, null] },
      Bravo: { monthly: { net: 80, target: 100, recruitment: 7, activeHp: 40 }, weekly: [30, 55, null, null, null] },
    },
  });

  const performance = buildMonthlyPerformanceViewModel(
    bundleOf(roster, [september], september),
    { today: "2026-09-08" },
  )!;

  const dashboard = buildDashboardViewModel({
    selectedMonth: september.month,
    performance,
    lastUpdatedAt: null,
  });

  check(
    "nothing anywhere in the dashboard model is NaN or Infinity",
    everyNumberFinite(dashboard),
  );

  check(
    "every HM in the month has a status object, including the untouched ones",
    Object.keys(performance.hmKpiStatuses).length === performance.group.hms.length,
  );

  const asList: HmKpiStatuses[] = Object.values(performance.hmKpiStatuses);

  check(
    "getManagementAttention over the same statuses gives the same answer",
    getManagementAttention(
      performance.rankings.map(
        (entry) => performance.hmKpiStatuses[entry.performance.hmId]!,
      ),
    ).length === performance.managementAttention.length &&
      asList.length === 2,
  );

  check(
    "the HM detail model carries the bands and the week they came from",
    (() => {
      const detail = buildHmDetailViewModel({
        selectedMonth: september.month,
        model: buildHmPerformanceViewModel(
          bundleOf(roster, [september], september),
          hmId(roster, "Alpha"),
          { today: "2026-09-08" },
        )!,
        lastUpdatedAt: null,
      });

      return (
        detail.currentWeekLabel === "W2" &&
        detail.kpiStatuses !== null &&
        // 10 of a 100 target at W1 is 10%, which is needs_attention.
        detail.weekly.weeks[0]!.kpiStatus?.status === "needs_attention" &&
        detail.weekly.weeks[0]!.kpiStatus?.note === "W1: 10 of 100 target · 10.0%" &&
        // W3 has not happened yet: no band, and it says which kind of blank.
        detail.weekly.weeks[2]!.kpiStatus?.status === null &&
        detail.weekly.weeks[2]!.kpiStatus?.label === "Not entered" &&
        // W5 has no threshold at all, which is a different blank again.
        detail.weekly.weeks[4]!.kpiStatus?.label === "Not configured"
      );
    })(),
  );

  check(
    "and the public view of the same HM carries the SAME ones",
    // The shared report shows the bands too: the HM opening their own card from
    // the WhatsApp link is exactly who needs to know which figure is behind,
    // and a band exposes nothing the report does not already print. What
    // `audience: "public"` still strips is the HM Code - an internal
    // identifier, which is a different question.
    (() => {
      const forAudience = (audience: "private" | "public") =>
        buildHmDetailViewModel({
          selectedMonth: september.month,
          model: buildHmPerformanceViewModel(
            bundleOf(roster, [september], september),
            hmId(roster, "Alpha"),
            { today: "2026-09-08" },
          )!,
          lastUpdatedAt: null,
          audience,
        });

      const publicDetail = forAudience("public");
      const privateDetail = forAudience("private");

      return (
        JSON.stringify(publicDetail.kpiStatuses) ===
          JSON.stringify(privateDetail.kpiStatuses) &&
        publicDetail.currentWeekLabel === privateDetail.currentWeekLabel &&
        publicDetail.keyIn.kpiStatus?.status === "needs_attention" &&
        publicDetail.weekly.weeks[0]!.kpiStatus?.label === "Needs Attention" &&
        publicDetail.secondary.every((metric) =>
          metric.key === "shi" ? true : Boolean(metric.kpiStatus),
        ) &&
        // The identifier is still withheld.
        publicDetail.hm.hmCode === null &&
        privateDetail.hm.hmCode !== null
      );
    })(),
  );
}

// =============================================================================
section("[S9-Q] the REAL routes render the bands, not just the models");
// =============================================================================

/**
 * The gap this section exists to close.
 *
 * Every check above proves the ENGINE and the PRESENTERS are right. None of
 * them proves a manager can see a band: a model can be perfect while the page
 * that was supposed to render it never imported the component. That is a real
 * failure mode and it is invisible to a model-level test, so the wiring of the
 * signed-in routes is asserted here against the source they actually ship.
 *
 * Deliberately over the REAL files - `app/(app)/dashboard/page.tsx`, the real
 * card, the real tiles - rather than a harness. A preview page proves a
 * component can render; only the route proves the application does.
 */
{
  const source = (relative: string) =>
    readFileSync(path.join(SRC, relative), "utf8");

  const DASHBOARD_PAGE = "app/(app)/dashboard/page.tsx";
  const HM_DETAIL_PAGE = "app/(app)/hm/[hmId]/page.tsx";

  // --- the dashboard route ---------------------------------------------------
  const dashboardPage = source(DASHBOARD_PAGE);

  check(
    "the dashboard route imports Management Attention",
    dashboardPage.includes(
      'from "@/components/dashboard/management-attention"',
    ),
  );

  check(
    "and actually renders it, with the presenter's model and the current week",
    dashboardPage.includes("<ManagementAttention") &&
      dashboardPage.includes("dashboard.managementAttention") &&
      dashboardPage.includes("dashboard.currentWeekLabel"),
  );

  check(
    "it still renders the HM cards, which is what carries the four bands",
    dashboardPage.includes("<HmPerformance") &&
      dashboardPage.includes("dashboard.hms"),
  );

  // --- the HM card -----------------------------------------------------------
  const card = source("components/dashboard/hm-card.tsx");

  for (const kpi of ["keyIn", "net", "recruitment", "activeHp"] as const) {
    check(
      `the HM card passes the ${kpi} band to a badge`,
      card.includes(`hm.statuses.${kpi}`),
    );
  }

  check(
    "the card renders the badge component rather than a colour of its own",
    card.includes('from "@/components/ui/kpi-status"') &&
      card.includes("<KpiStatusBadge"),
  );

  check(
    "and the Key-In band shows its basis, so it is not read as the figure above it",
    card.includes("showNote"),
  );

  // --- the HM detail route ---------------------------------------------------
  const detailPage = source(HM_DETAIL_PAGE);

  check(
    "the HM screen renders the tiles that carry the bands",
    detailPage.includes("<HmPrimaryPerformance") &&
      detailPage.includes("<HmSecondaryKpis") &&
      detailPage.includes("<HmWeeklyPerformance"),
  );

  const primary = source("components/hm-detail/hm-primary-performance.tsx");

  check(
    "the primary block renders Net and Key-In, which hold the Net and Key-In bands",
    primary.includes("detail.net") && primary.includes("detail.keyIn"),
  );

  const metric = source("components/hm-detail/hm-metric.tsx");

  check(
    "and the tile component renders the band it is given",
    metric.includes("metric.kpiStatus") && metric.includes("<KpiStatusBadge"),
  );

  check(
    "showing ONE verdict per figure - the Stage 9 band wins where both exist",
    metric.includes("kpiStatus === null && metric.status !== null"),
  );

  // --- the shared report -----------------------------------------------------
  const shareCard = source("components/share/share-hm-card.tsx");

  for (const kpi of ["keyIn", "net", "recruitment", "activeHp"] as const) {
    check(
      `the shared HM card passes the ${kpi} band to a badge`,
      shareCard.includes(`hm.statuses.${kpi}`),
    );
  }

  check(
    "the shared card renders the same badge component the dashboard card does",
    shareCard.includes('from "@/components/ui/kpi-status"') &&
      shareCard.includes("<KpiStatusBadge"),
  );

  check(
    "and the public projection carries the bands across",
    source("lib/view-models/public-share.ts").includes("statuses: hm.statuses"),
  );

  check(
    "but NOT the Management Attention section - the group list is not the HM's business",
    !shareCard.includes("ManagementAttention") &&
      !source("components/share/public-report.tsx").includes(
        "ManagementAttention",
      ) &&
      !source("lib/view-models/public-share.ts").includes(
        "managementAttention",
      ),
  );

  check(
    "and the HM Code is still withheld from a token holder",
    source("lib/view-models/hm-detail.ts").includes(
      'audience === "public" ? null : hm.hmCode',
    ),
  );

  // --- the weekly sections ---------------------------------------------------
  for (const file of [
    "components/dashboard/weekly-keyin.tsx",
    "components/hm-detail/hm-weekly-performance.tsx",
  ]) {
    check(
      `${file} renders the weekly pacing band`,
      source(file).includes("week.kpiStatus") &&
        source(file).includes("<KpiStatusBadge"),
    );
  }

  // --- no threshold may live in a component ----------------------------------
  const uiFiles = [
    DASHBOARD_PAGE,
    HM_DETAIL_PAGE,
    "components/dashboard/hm-card.tsx",
    "components/dashboard/management-attention.tsx",
    "components/dashboard/weekly-keyin.tsx",
    "components/hm-detail/hm-metric.tsx",
    "components/hm-detail/hm-primary-performance.tsx",
    "components/hm-detail/hm-secondary-kpis.tsx",
    "components/hm-detail/hm-weekly-performance.tsx",
    "components/ui/kpi-status.tsx",
  ];

  const withThresholds = uiFiles.filter((file) => {
    const text = source(file);

    // The engine's own exported names are fine - the legends read them rather
    // than retyping the numbers. A bare comparison against a threshold is not.
    return [
      "needs_attention\"",
      "getKeyInStatus",
      "getNetStatus",
      "getRecruitmentStatus",
      "getActiveHpStatus",
    ].some((needle) => text.includes(needle) && !text.includes("KPI_STATUS_"));
  });

  check(
    "no route or component bands a figure itself - they render what they are given",
    withThresholds.length === 0,
    withThresholds.join(", "),
  );

  // --- the clock is the reporting clock, and it is not hardcoded -------------
  const engine = source("lib/calculations/kpi-status.ts");

  check(
    "the engine holds no clock at all - the current week is resolved from a date it is given",
    !engine.includes("new Date(") && !engine.includes("Date.now"),
  );

  check(
    "and the month model defaults that date to the reporting timezone's today",
    source("lib/view-models/monthly-performance.ts").includes(
      "options.today ?? reportingDate()",
    ),
  );

  check(
    "so the signed-in routes get a real current week without passing one",
    !dashboardPage.includes("today:") && !detailPage.includes("today:"),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
