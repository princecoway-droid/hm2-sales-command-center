/**
 * Stage 6 tests: the WhatsApp report and the read-only share view.
 *
 *   npm run test:stage6
 *
 * Same shape as Stages 1-5 - plain Node, no framework, one file, the Stage 3
 * fixtures reused so a scenario is a spec rather than a page of literal rows.
 *
 * ---------------------------------------------------------------------------
 * What is being tested, and what deliberately is not
 * ---------------------------------------------------------------------------
 * NOT the formulas, again: Achievement, Net Ratio, the totals, the bands and
 * the ranking are proved against the engine in `stage3.test.mts`.
 *
 * What IS tested here is the thing this stage can uniquely get wrong: a message
 * pasted into a WhatsApp group, or a page opened by someone with no account,
 * saying something different from the dashboard it came from. So the central
 * assertions are equalities between three surfaces built from ONE month -
 * dashboard, report text, public page - and they are written as "the same
 * string appears in all three", never as a recomputed expectation.
 *
 * The other half is the boundary: that a token is unguessable, that the public
 * projection carries no audit column or internal id, that no month but the
 * token's can be reached, and that the private routes stayed private. Those
 * that live in SQL - revocation, expiry, the anon grant - are proved against a
 * real Postgres in `supabase/tests/schema.test.mjs`; this file proves the ones
 * that live in TypeScript, and asserts the source-level facts that no runtime
 * test can (that the public page reads no search parameters, that the share
 * data module never reaches for the service-role client).
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { formatPercentage, formatUnits } from "@/lib/calculations";
import { ROUTES, PUBLIC_ROUTES, isPublicRoute, sharePath } from "@/lib/routes";
import {
  SHARE_LINK_EXPIRY_DAYS,
  SHARE_TOKEN_LENGTH,
  SHARE_TOKEN_MIN_LENGTH,
} from "@/lib/share/config";
import {
  generateShareToken,
  isExpired,
  isShareTokenShaped,
  shareLinkExpiry,
} from "@/lib/share/token";
import {
  generateWhatsAppReport,
  STATUS_EMOJI,
} from "@/lib/reports/whatsapp";
import {
  buildDashboardViewModel,
  type DashboardViewModel,
  type KpiKey,
} from "@/lib/view-models/dashboard";
import { buildShareReport, parseSharePayload } from "@/lib/share/resolve";
import {
  applyRevokedLink,
  countShareLinks,
  isTokenRevoked,
} from "@/lib/share/link-list";
import {
  isHttpsAppUrl,
  joinUrl,
  normalizeAppUrl,
  resolveAppOrigin,
} from "@/lib/share/url";
import type { ShareLinkSummary } from "@/lib/data/share";
import {
  buildPublicShareViewModel,
  type PublicShareViewModel,
} from "@/lib/view-models/public-share";
import {
  buildMonthlyPerformanceViewModel,
  type MonthPerformanceRecords,
  type PerformanceBundle,
} from "@/lib/view-models/monthly-performance";
import {
  FOUR_WEEKS,
  SEPTEMBER_WEEKS,
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

const SHARE_URL = "https://hm2.example.com/share/EXAMPLE-TOKEN";

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

/** A dashboard from month records, exactly as the page builds it. */
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

/**
 * All three surfaces for one month.
 *
 * Built through the real chain in every case - engine, dashboard presenter,
 * then the report generator and the public projection - so an equality asserted
 * below is an equality the application actually has.
 */
function surfacesOf(
  roster: Roster,
  months: MonthPerformanceRecords[],
  selected: MonthPerformanceRecords,
  options: { groupShiPct?: number | null; lastUpdatedAt?: string | null } = {},
): {
  dashboard: DashboardViewModel;
  report: string;
  publicView: PublicShareViewModel;
} {
  const dashboard = dashboardOf(roster, months, selected, options);

  return {
    dashboard,
    report: generateWhatsAppReport(dashboard, { shareUrl: SHARE_URL }),
    publicView: buildPublicShareViewModel(dashboard),
  };
}

function kpi(dashboard: DashboardViewModel, key: KpiKey) {
  const tile = dashboard.kpis.find((entry) => entry.key === key);

  if (!tile) {
    throw new Error(`No KPI tile for "${key}".`);
  }

  return tile;
}

function publicKpi(view: PublicShareViewModel, key: string) {
  const tile = view.kpis.find((entry) => entry.key === key);

  if (!tile) {
    throw new Error(`No public KPI tile for "${key}".`);
  }

  return tile;
}

/** The line of the report that starts with a label, e.g. "📤 Net:". */
function reportLine(report: string, startsWith: string): string | null {
  return (
    report.split("\n").find((line) => line.includes(startsWith)) ?? null
  );
}

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

function read(relative: string): string {
  return readFileSync(path.join(SRC, relative), "utf8");
}

/**
 * A source file with its comments removed.
 *
 * Needed because several assertions below are of the form "this word does not
 * appear in this file", and the files in this project explain themselves at
 * length - the share layout's comment says it does NOT render `AppShell`, which
 * is exactly the string the naive check was looking for. Stripping the prose
 * leaves the assertion testing the code rather than the documentation of it.
 */
function readCode(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** One exported function's body, for assertions scoped to it. */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);

  if (start === -1) {
    throw new Error(`No function matching "${signature}".`);
  }

  const end = source.indexOf("\n}", start);

  return source.slice(start, end === -1 ? undefined : end);
}

function readMigration(): string {
  const dir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "supabase",
    "migrations",
  );

  return readFileSync(
    path.join(dir, "20260905120000_share_links.sql"),
    "utf8",
  );
}

/** A full, healthy September. The baseline most sections start from. */
function completeSeptember() {
  const roster = createRoster(["Alpha", "Bravo", "Charlie", "Delta"]);

  const september = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: {
        monthly: { net: 76, target: 100, recruitment: 6, activeHp: 31 },
        weekly: [20, 18, 22, 16, 5],
      },
      Bravo: {
        monthly: { net: 71, target: 90, recruitment: 4, activeHp: 29 },
        weekly: [18, 20, 17, 14, 4],
      },
      Charlie: {
        monthly: { net: 65, target: 90, recruitment: 5, activeHp: 27 },
        weekly: [16, 17, 15, 12, 3],
      },
      Delta: {
        monthly: { net: 58, target: 80, recruitment: 2, activeHp: 25 },
        weekly: [14, 15, 13, 11, 2],
      },
    },
  });

  return { roster, september };
}

// =============================================================================
section("[1] the report is generated from the dashboard's own figures");
// =============================================================================

{
  const { roster, september } = completeSeptember();
  const { dashboard, report } = surfacesOf(roster, [september], september, {
    groupShiPct: 72,
  });

  for (const key of [
    "keyIn",
    "net",
    "target",
    "achievement",
    "recruitment",
    "activeHp",
    "netRatio",
    "shi",
  ] as const) {
    const tile = kpi(dashboard, key);

    check(
      `the report carries the dashboard's ${tile.label} (${tile.value})`,
      report.includes(tile.value),
      `"${tile.value}" not in the report`,
    );
  }

  check(
    "Achievement is the engine's, not a division done in the report",
    report.includes(
      formatPercentage(
        // Read back off the engine model the dashboard was built from.
        dashboard.kpis.find((tile) => tile.key === "achievement")!.value ===
          "—"
          ? null
          : Number(
              dashboard.kpis
                .find((tile) => tile.key === "achievement")!
                .value.replace("%", ""),
            ),
      ),
    ),
  );

  check(
    "the reporting month is stated",
    report.includes(dashboard.month.label),
  );

  check("the share URL is present", report.includes(SHARE_URL));

  check(
    "and it is introduced rather than dropped in bare",
    report.includes("🔗 View Full Dashboard"),
  );
}

// =============================================================================
section("[2] the report contains no formula of its own");
// =============================================================================

{
  const source = read("lib/reports/whatsapp.ts");

  // The strongest available statement of "it contains no formula": the file
  // never names a raw engine figure at all, so there is nothing in scope to do
  // arithmetic ON. Every value it touches is an already-formatted string that
  // the presenter decided.
  const rawFigures = [
    "totalNet",
    "totalKeyIn",
    "totalTarget",
    "totalRecruitment",
    "totalActiveHp",
    "groupAchievementPct",
    "groupNetRatioPct",
    "groupShiPct",
    "netUnits",
    "keyInUnits",
    "targetNetUnits",
    "achievementPct",
  ];

  check(
    "it never names a raw engine figure - only formatted view-model strings",
    rawFigures.every((field) => !source.includes(field)),
    rawFigures.filter((field) => source.includes(field)).join(", "),
  );

  check(
    "no percentage or rounding of its own",
    !source.includes("toFixed") && !source.includes("Math."),
  );

  check(
    "no sorting - the Stage 3 ranking order is used as given",
    !source.includes(".sort("),
  );

  check(
    "no threshold constants - status arrives already decided",
    !source.includes("WEEKLY_KEYIN") && !source.includes("RECRUITMENT_GREEN"),
  );

  check(
    "no aggregation of its own",
    !source.includes("reduce(") && !source.includes(".filter("),
  );

  check(
    "it reads the view model, not the database",
    source.includes("DashboardViewModel") &&
      !source.includes("supabase") &&
      !source.includes("from(\""),
  );

  check(
    "pure: no React, no browser, no clock",
    !source.includes("react") &&
      !source.includes("navigator") &&
      !source.includes("new Date("),
  );
}

// =============================================================================
section("[3] blanks stay blank - no NaN, no Infinity, no invented zero");
// =============================================================================

{
  const roster = createRoster(["Alpha", "Bravo"]);

  // Nothing entered at all: no monthly rows, no weekly Key-In, no group SHI.
  const empty = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {},
  });

  const { dashboard, report, publicView } = surfacesOf(
    roster,
    [empty],
    empty,
  );

  check("no NaN anywhere in the report", !report.includes("NaN"));
  check("no Infinity anywhere in the report", !report.includes("Infinity"));
  check("no undefined leaking into the text", !report.includes("undefined"));
  check("no null leaking into the text", !report.includes("null"));

  check(
    "Key-In reads as an em dash, not 0",
    reportLine(report, "📥 Key-In:")?.includes("—") === true,
    reportLine(report, "📥 Key-In:") ?? "line missing",
  );

  check(
    "and carries no unit, because \"— units\" reads as a broken number",
    reportLine(report, "📥 Key-In:")?.includes("units") === false,
  );

  check(
    "Net reads as an em dash",
    reportLine(report, "📤 Net:")?.includes("—") === true,
  );

  check(
    "Achievement reads as an em dash rather than 0.0%",
    reportLine(report, "📈 Achievement:")?.includes("—") === true,
  );

  check(
    "the dashboard says the same about Key-In",
    kpi(dashboard, "keyIn").value === "—",
  );

  check(
    "and so does the public view",
    publicKpi(publicView, "keyIn").value === "—",
  );

  check(
    "the public page reports no data rather than a month of zeros",
    publicView.hasAnyData === false,
  );
}

// =============================================================================
section("[4] a blank week is neutral, never red");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);

  // W1-W3 entered across the bands, W4 and W5 never keyed in.
  const partial = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: SEPTEMBER_WEEKS,
    hms: {
      Alpha: {
        monthly: { net: 40, target: 60 },
        weekly: [20, 12, 4, null, null],
      },
    },
  });

  const { dashboard, report, publicView } = surfacesOf(
    roster,
    [partial],
    partial,
  );

  const bands = dashboard.weekly.weeks.map((week) => week.status);

  check(
    "W1 above the green threshold is green",
    bands[0] === "green",
    bands.join(", "),
  );
  check("W2 inside the band is yellow", bands[1] === "yellow");
  check("W3 below the band is red", bands[2] === "red");
  check("W4, never entered, is neutral - not red", bands[3] === "neutral");
  check("W5, never entered, is neutral - not red", bands[4] === "neutral");

  for (const [index, week] of dashboard.weekly.weeks.entries()) {
    check(
      `${week.label} carries the engine's emoji in the report`,
      reportLine(report, `${week.label} `)?.includes(
        STATUS_EMOJI[week.status],
      ) === true,
      `${week.label}: expected ${STATUS_EMOJI[week.status]}`,
    );

    check(
      `${week.label} matches on the public page too`,
      publicView.weekly.weeks[index]?.status === week.status,
    );
  }

  check(
    "a blank week shows an em dash rather than 0 units",
    reportLine(report, "W4 ")?.trim() === `W4 ${STATUS_EMOJI.neutral} —`,
    reportLine(report, "W4 ") ?? "missing",
  );

  check(
    "every entered week states its units",
    reportLine(report, "W1 ")?.includes("units") === true,
  );
}

// =============================================================================
section("[5] W1-W6: however many periods the month has");
// =============================================================================

{
  const roster = createRoster(["Alpha"]);

  const six = [
    ["2026-08-30", "2026-09-05"],
    ["2026-09-06", "2026-09-12"],
    ["2026-09-13", "2026-09-19"],
    ["2026-09-20", "2026-09-26"],
    ["2026-09-27", "2026-09-29"],
    ["2026-09-30", "2026-09-30"],
  ] as const;

  for (const [label, weeks, expected] of [
    ["four", FOUR_WEEKS, 4],
    ["five", SEPTEMBER_WEEKS, 5],
    ["six", six, 6],
  ] as const) {
    const records = buildMonthRecords(roster, {
      year: 2026,
      month: 9,
      weeks,
      hms: { Alpha: { monthly: { net: 10 }, weekly: [12] } },
    });

    const { report, publicView } = surfacesOf(roster, [records], records);

    check(
      `${label} periods: every week appears in the report`,
      Array.from({ length: expected }, (_, i) => `W${i + 1} `).every((prefix) =>
        report.includes(prefix),
      ),
    );

    check(
      `${label} periods: the public page renders the same count`,
      publicView.weekly.weeks.length === expected,
    );

    check(
      `${label} periods: no phantom W${expected + 1}`,
      !report.includes(`W${expected + 1} `),
    );
  }

  // No sales calendar at all.
  const noWeeks = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    weeks: [],
    hms: { Alpha: { monthly: { net: 10 } } },
  });

  const { report, publicView } = surfacesOf(roster, [noWeeks], noWeeks);

  check(
    "no configured weeks: the report says so rather than showing an empty block",
    report.includes("No sales weeks configured yet"),
  );

  check(
    "and the public page says so too",
    publicView.weekly.hasWeeks === false,
  );

  check("still no NaN", !report.includes("NaN"));
}

// =============================================================================
section("[6] recruitment status is mapped, never re-derived");
// =============================================================================

{
  const roster = createRoster(["Green", "Yellow", "Red", "Blank"]);

  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Green: { monthly: { net: 40, recruitment: 6 } },
      Yellow: { monthly: { net: 30, recruitment: 1 } },
      Red: { monthly: { net: 20, recruitment: 0 } },
      // No monthly row at all - recruitment is unknown, not zero.
      Blank: { weekly: [5] },
    },
  });

  const { dashboard, report } = surfacesOf(roster, [records], records);

  for (const hm of dashboard.hms) {
    const line = report
      .split("\n")
      .find((entry) => entry.includes(`${hm.recruitmentLabel} Recruit`));

    check(
      `${hm.name}: the report uses the engine's recruitment band`,
      line?.includes(STATUS_EMOJI[hm.recruitmentStatus]) === true,
      `${hm.name} expected ${STATUS_EMOJI[hm.recruitmentStatus]} in "${line}"`,
    );
  }

  check(
    "an HM with no monthly row shows an em dash, not 0 recruits",
    report.includes("— Recruit"),
  );
}

// =============================================================================
section("[7] the HM league table is the Stage 3 ranking, unaltered");
// =============================================================================

{
  const { roster, september } = completeSeptember();
  const { dashboard, report, publicView } = surfacesOf(
    roster,
    [september],
    september,
  );

  const dashboardOrder = dashboard.hms.map((hm) => hm.name);
  const publicOrder = publicView.hms.map((hm) => hm.name);

  check(
    "the public page lists the HMs in the dashboard's order",
    publicOrder.join(",") === dashboardOrder.join(","),
    `${publicOrder.join(",")} vs ${dashboardOrder.join(",")}`,
  );

  const positions = dashboardOrder.map((name) => report.indexOf(`\n${name}`) >= 0
    ? report.indexOf(`\n${name}`)
    : report.indexOf(name));

  check(
    "the report lists them in that order too",
    positions.every((at, index) => index === 0 || at > positions[index - 1]!),
    positions.join(", "),
  );

  check("the leader gets a gold medal", report.includes(`🥇 ${dashboardOrder[0]}`));
  check("second gets silver", report.includes(`🥈 ${dashboardOrder[1]}`));
  check("third gets bronze", report.includes(`🥉 ${dashboardOrder[2]}`));

  check(
    "fourth gets their name and no medal",
    report.includes(`\n${dashboardOrder[3]}\n`) &&
      !report.includes(`🥉 ${dashboardOrder[3]}`),
  );

  for (const hm of dashboard.hms) {
    check(
      `${hm.name}: Net matches the dashboard card`,
      report.includes(`${hm.netLabel} Net`),
    );
    check(
      `${hm.name}: Key-In matches the dashboard card`,
      report.includes(`${hm.keyInLabel} KI`),
    );
    check(
      `${hm.name}: Active HP matches the dashboard card`,
      report.includes(`${hm.activeHpLabel} Active`),
    );
  }
}

// =============================================================================
section("[8] the report leaves out what belongs on the full dashboard");
// =============================================================================

{
  const { roster, september } = completeSeptember();
  const august = buildMonthRecords(roster, {
    year: 2026,
    month: 8,
    weeks: FOUR_WEEKS,
    hms: { Alpha: { monthly: { net: 60 }, weekly: [15, 15, 15, 15] } },
  });

  const { report } = surfacesOf(roster, [september, august], september, {
    groupShiPct: 72,
  });

  check("no Extrade split", !report.includes("Extrade"));
  check("no month-over-month block", !report.toLowerCase().includes("last month"));
  check("no quarter-to-date block", !report.includes("QTD") && !report.includes("Q3"));
  check("no per-HM SHI", (report.match(/SHI/g) ?? []).length === 1);
  check("no per-HM target line", !report.includes("Target:") || (report.match(/Target/g) ?? []).length === 1);

  check(
    "and it stays short enough to read on a phone",
    report.split("\n").every((line) => line.length <= 80),
    report.split("\n").filter((line) => line.length > 80).join(" | "),
  );
}

// =============================================================================
section("[9] incomplete data is stated, not hidden");
// =============================================================================

{
  const roster = createRoster(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);

  const partial = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 40 }, weekly: [12] },
      Bravo: { monthly: { net: 35 }, weekly: [11] },
      Charlie: { monthly: { net: 30 }, weekly: [10] },
      Delta: { monthly: { net: 25 }, weekly: [9] },
    },
  });

  const { dashboard, report, publicView } = surfacesOf(
    roster,
    [partial],
    partial,
  );

  check(
    "the dashboard counts four of six",
    dashboard.completeness.headline === "4 of 6 HMs updated",
    dashboard.completeness.headline,
  );

  check(
    "the report says the same, with a warning marker",
    report.includes("⚠️ 4 of 6 HMs updated"),
  );

  check(
    "the public page says the same",
    publicView.completeness.headline === "4 of 6 HMs updated",
  );

  check(
    "the missing HMs are named rather than silently dropped",
    publicView.completeness.detail?.includes("Echo") === true &&
      publicView.completeness.detail?.includes("Foxtrot") === true,
    publicView.completeness.detail ?? "no detail",
  );

  check(
    "and they still appear in the league table as not entered",
    publicView.hms.some(
      (hm) => hm.name === "Echo" && hm.hasMonthlyRecord === false,
    ),
  );

  // Now the complete case.
  const { roster: fullRoster, september } = completeSeptember();
  const complete = surfacesOf(fullRoster, [september], september);

  check(
    "a complete month gets a tick, not a warning",
    complete.report.includes("✅ All 4 HMs updated"),
    reportLine(complete.report, "HMs updated") ?? "missing",
  );

  check(
    "and the public page agrees",
    complete.publicView.completeness.level === "complete",
  );
}

// =============================================================================
section("[10] Group SHI is read, never substituted");
// =============================================================================

{
  const roster = createRoster(["Alpha", "Bravo"]);

  // Both HMs carry an SHI of their own. The group figure is absent.
  const withoutGroupShi = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: { monthly: { net: 40, shi: 88 }, weekly: [12] },
      Bravo: { monthly: { net: 30, shi: 92 }, weekly: [11] },
    },
  });

  const absent = surfacesOf(roster, [withoutGroupShi], withoutGroupShi, {
    groupShiPct: null,
  });

  check(
    "with no group SHI the dashboard says Not entered",
    kpi(absent.dashboard, "shi").value === "—" &&
      kpi(absent.dashboard, "shi").note === "Not entered",
  );

  check(
    "the report shows an em dash, never the mean of the HM column",
    reportLine(absent.report, "❤️ SHI:")?.includes("—") === true,
    reportLine(absent.report, "❤️ SHI:") ?? "missing",
  );

  check(
    "and never 90.0%, which is what averaging 88 and 92 would have produced",
    !absent.report.includes("90.0%"),
  );

  check(
    "the public page shows Not entered as well",
    publicKpi(absent.publicView, "shi").value === "—" &&
      publicKpi(absent.publicView, "shi").note === "Not entered",
  );

  const present = surfacesOf(roster, [withoutGroupShi], withoutGroupShi, {
    groupShiPct: 72,
  });

  check(
    "when the eTrust figure IS keyed in, it is what shows",
    present.report.includes(formatPercentage(72)),
    formatPercentage(72),
  );

  check(
    "on the public page too",
    publicKpi(present.publicView, "shi").value === formatPercentage(72),
  );
}

// =============================================================================
section("[11] names are carried verbatim - long, punctuated or otherwise");
// =============================================================================

{
  const awkward = "Nur A/P Abdullah-Rahman (KL) & Co.";
  const long = "Muhammad Aiman Bin Abdul Rahman Al-Hafiz Bin Ismail";

  const roster = createRoster([
    { name: awkward, office: "Amcorp Mall · L3" },
    { name: long, office: "Kota Damansara" },
    { name: "Zoë O'Brien", office: "Setia Alam" },
  ]);

  const records = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      [awkward]: { monthly: { net: 40 }, weekly: [12] },
      [long]: { monthly: { net: 35 }, weekly: [11] },
      "Zoë O'Brien": { monthly: { net: 30 }, weekly: [10] },
    },
  });

  const { report, publicView } = surfacesOf(roster, [records], records);

  check("a name with slashes and brackets survives", report.includes(awkward));
  check("a very long name is not truncated", report.includes(long));
  check("an accented, apostrophed name survives", report.includes("Zoë O'Brien"));

  check(
    "the public view carries the same names",
    publicView.hms.map((hm) => hm.name).includes(awkward),
  );

  check(
    "nothing was HTML- or markdown-escaped on the way",
    !report.includes("&amp;") && !report.includes("\\&"),
  );
}

// =============================================================================
section("[12] the awkward months: no HMs, no target, all zeros");
// =============================================================================

{
  // An empty roster.
  const none = createRoster([]);
  const emptyMonth = buildMonthRecords(none, {
    year: 2026,
    month: 9,
    hms: {},
  });

  const noHms = surfacesOf(none, [emptyMonth], emptyMonth);

  check("no HMs: the report still renders", noHms.report.length > 0);
  check("no HMs: it says so", noHms.report.includes("No HM records"));
  check("no HMs: no NaN", !noHms.report.includes("NaN"));
  check(
    "no HMs: completeness does not claim a green tick",
    noHms.publicView.completeness.level === "empty",
  );

  // Figures entered, no target set.
  const roster = createRoster(["Alpha"]);
  const noTarget = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: { Alpha: { monthly: { net: 40, target: 0 }, weekly: [12] } },
  });

  const missingTarget = surfacesOf(roster, [noTarget], noTarget);

  check(
    "no target: Achievement is an em dash, never Infinity",
    reportLine(missingTarget.report, "📈 Achievement:")?.includes("—") === true,
    reportLine(missingTarget.report, "📈 Achievement:") ?? "missing",
  );

  check(
    "no target: the public target track knows it has nothing to draw",
    missingTarget.publicView.target.hasTarget === false &&
      missingTarget.publicView.target.progressPct === null,
  );

  // A real, entered zero month.
  const zeros = buildMonthRecords(roster, {
    year: 2026,
    month: 9,
    hms: {
      Alpha: {
        monthly: { net: 0, target: 50, recruitment: 0, activeHp: 0 },
        weekly: [0, 0, 0, 0, 0],
      },
    },
  });

  const allZero = surfacesOf(roster, [zeros], zeros);

  check(
    "an entered zero reads as 0, not as an em dash",
    reportLine(allZero.report, "📤 Net:")?.includes("0") === true &&
      !reportLine(allZero.report, "📤 Net:")?.includes("—"),
    reportLine(allZero.report, "📤 Net:") ?? "missing",
  );

  check(
    "a zero week is red, because it happened and it was zero",
    allZero.dashboard.weekly.weeks[0]?.status === "red",
  );

  check(
    "achievement of a zero month is 0.0%, not blank",
    allZero.report.includes(formatPercentage(0)),
  );

  check("no Infinity", !allZero.report.includes("Infinity"));
}

// =============================================================================
section("[13] one string: the preview is the clipboard");
// =============================================================================

{
  const { roster, september } = completeSeptember();
  const dashboard = dashboardOf(roster, [september], september);

  const first = generateWhatsAppReport(dashboard, { shareUrl: SHARE_URL });
  const second = generateWhatsAppReport(dashboard, { shareUrl: SHARE_URL });

  check("the generator is deterministic", first === second);

  const withoutUrl = generateWhatsAppReport(dashboard);

  check(
    "with no share URL the link block is omitted, not left broken",
    !withoutUrl.includes("🔗") && !withoutUrl.includes("undefined"),
  );

  check(
    "and the figures are otherwise identical",
    withoutUrl.length < first.length &&
      first.startsWith(withoutUrl.split("\n").slice(0, 5).join("\n")),
  );

  const panel = read("components/dashboard/whatsapp-report.tsx");

  check(
    "the panel renders the server-generated string rather than rebuilding it",
    panel.includes("payload.reportText") &&
      !panel.includes('from "@/lib/reports/whatsapp"'),
  );

  check(
    "the same value is what the copy button writes",
    panel.includes("<CopyButton") && panel.includes("value={text}"),
  );

  check(
    "clipboard failure falls back to selectable text rather than failing silently",
    panel.includes("navigator.clipboard") &&
      panel.includes("selectOnFallback") &&
      panel.includes("textarea.select()"),
  );

  check(
    "success is announced, not just coloured",
    panel.includes('aria-live="polite"') && panel.includes("✓ Report copied"),
  );
}

// =============================================================================
section("[14] tokens are unguessable and not derived from anything");
// =============================================================================

{
  const tokens = new Set<string>();

  for (let i = 0; i < 500; i += 1) {
    tokens.add(generateShareToken());
  }

  check("500 tokens, 500 distinct values", tokens.size === 500);

  const sample = [...tokens];

  check(
    `every token is ${SHARE_TOKEN_LENGTH} characters`,
    sample.every((token) => token.length === SHARE_TOKEN_LENGTH),
  );

  check(
    "base64url only - no padding, no slashes, nothing needing escaping",
    sample.every((token) => /^[A-Za-z0-9_-]+$/.test(token)),
  );

  check(
    "no shared prefix, so tokens are not counter- or time-ordered",
    new Set(sample.map((token) => token.slice(0, 6))).size > 400,
  );

  // The shape gate, which is what a probe hits first.
  // A uuid is 36 characters and its dashes are legal base64url, so it clears
  // both the length floor and the character class. It has to be refused by
  // name, or "try the month id as a token" passes the gate.
  check(
    "a uuid is not a token",
    !isShareTokenShaped("3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
  );
  check(
    "an uppercase uuid is not a token either",
    !isShareTokenShaped("3F2504E0-4F89-11D3-9A0C-0305E82C3301"),
  );
  check("an empty string is not a token", !isShareTokenShaped(""));
  check("a short slug is not a token", !isShareTokenShaped("september-2026"));
  check("a month param is not a token", !isShareTokenShaped("2026-09"));
  check(
    "base64 with padding is not a token",
    !isShareTokenShaped("aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgc3RyaW5n=="),
  );
  check(
    "a path traversal attempt is not a token",
    !isShareTokenShaped("../../../etc/passwd-padded-out-to-thirty-two-chars"),
  );
  check("a non-string is not a token", !isShareTokenShaped(12345));
  check(
    `anything under ${SHARE_TOKEN_MIN_LENGTH} characters is rejected`,
    !isShareTokenShaped("a".repeat(SHARE_TOKEN_MIN_LENGTH - 1)) &&
      isShareTokenShaped("a".repeat(SHARE_TOKEN_MIN_LENGTH)),
  );
  check(
    "a real token passes the gate",
    sample.every((token) => isShareTokenShaped(token)),
  );

  const source = readCode("lib/share/token.ts");
  const generator = functionBody(source, "export function generateShareToken");

  check(
    "generated from the platform CSPRNG",
    generator.includes("crypto.getRandomValues"),
  );

  check(
    "the generator derives the token from nothing - no clock, no id, no seed",
    !generator.includes("Math.random") &&
      !generator.includes("randomUUID") &&
      !generator.includes("Date") &&
      !generator.includes("monthId") &&
      !generator.includes("hmId"),
  );

  check(
    "and Math.random appears nowhere in the module",
    !source.includes("Math.random") && !source.includes("randomUUID"),
  );
}

// =============================================================================
section("[15] expiry: supported, off by default, and stated when on");
// =============================================================================

{
  const now = new Date("2026-09-05T10:00:00Z");

  check(
    "the shipped default is no expiry - links are revoked, not timed out",
    SHARE_LINK_EXPIRY_DAYS === null,
  );

  check(
    "no expiry means no stored date",
    shareLinkExpiry(SHARE_LINK_EXPIRY_DAYS, now) === null,
  );

  const sevenDays = shareLinkExpiry(7, now);

  check(
    "seven days resolves to a date seven days out",
    sevenDays === "2026-09-12T10:00:00.000Z",
    String(sevenDays),
  );

  check("a null expiry never expires", !isExpired(null, now));
  check(
    "a future expiry has not expired",
    !isExpired("2026-09-12T10:00:00.000Z", now),
  );
  check(
    "a past expiry has",
    isExpired("2026-09-04T10:00:00.000Z", now),
  );
  check(
    "the exact moment counts as expired",
    isExpired("2026-09-05T10:00:00.000Z", now),
  );
  check(
    "an unparseable stamp is treated as expired, which is the safe direction",
    isExpired("not-a-date", now),
  );
  check("zero or negative days means no expiry", shareLinkExpiry(0, now) === null);

  const panel = read("components/dashboard/whatsapp-report.tsx");

  check(
    "the panel states the terms rather than leaving them to be discovered",
    panel.includes("Does not expire") && panel.includes("Expires "),
  );

  check(
    "and the link list shows an Expiry column",
    panel.includes(">Expiry<") && panel.includes(">Status<"),
  );

  check(
    "with Revoke available on an active link",
    panel.includes("Revoke") && panel.includes("revokeShareLinkAction"),
  );

  // Revoking the link the panel is currently showing must not silently mint a
  // replacement. Rebuilding the report after a revoke would ask for "this
  // month's link", find none, and hand back a new working one - so the PA
  // would press Revoke and be given a live link back.
  check(
    "revoking updates the link list rather than regenerating the report",
    panel.includes("onRevoked(result.link)") &&
      panel.includes("applyRevokedLink") &&
      !panel.includes("onChanged: () => generate()"),
  );

  check(
    "and revoking the current link stops that link being offered",
    panel.includes("currentRevoked") &&
      panel.includes("isTokenRevoked(links, payload.token)") &&
      panel.includes("has been revoked"),
  );

  check(
    "a new link is then created only when explicitly asked for",
    panel.includes("Create a new link") && panel.includes("rotate: true"),
  );
}

// =============================================================================
section("[16] the public view model is a projection, and drops what it must");
// =============================================================================

{
  const { roster, september } = completeSeptember();
  const { dashboard, publicView } = surfacesOf(roster, [september], september, {
    groupShiPct: 72,
    lastUpdatedAt: "2026-09-04T06:32:00Z",
  });

  const serialised = JSON.stringify(publicView);

  check("no hmId reaches the public model", !serialised.includes("hmId"));
  check("no href into the private app", !serialised.includes("href"));
  check("no month id", !serialised.includes(september.month.id));
  check(
    "no week ids",
    september.weeks.every((week) => !serialised.includes(week.id)),
  );
  check("no created_by", !serialised.includes("created_by"));
  check("no updated_by", !serialised.includes("updated_by"));
  check("no profile or auth field", !serialised.includes("profile") && !serialised.includes("auth"));

  check(
    "no month-over-month or quarter-to-date - the token names one month",
    !serialised.includes("monthOverMonth") && !serialised.includes("qtd"),
  );

  check(
    "no `?month=` parameter for a viewer to edit",
    !serialised.includes("param"),
  );

  check(
    "no PA-facing notice text",
    !serialised.includes("notice"),
  );

  check(
    "the freshness stamp is the data's, and it is carried through",
    publicView.updatedLabel === dashboard.updatedLabel &&
      publicView.updatedLabel !== null,
    String(publicView.updatedLabel),
  );

  check(
    "HM photo URLs are carried, since the bucket is read-public",
    publicView.hms.every((hm) => hm.photoUrl === null || typeof hm.photoUrl === "string"),
  );

  const source = read("lib/view-models/public-share.ts");

  check(
    "it is built from the dashboard view model, not from the engine again",
    source.includes("DashboardViewModel") &&
      !source.includes("calculateGroup") &&
      !source.includes("buildMonthlyPerformanceViewModel"),
  );

  check(
    "and it formats nothing itself",
    !source.includes("formatUnits") &&
      !source.includes("formatPercentage") &&
      !source.includes("toFixed"),
  );
}

// =============================================================================
section("[17] the three surfaces agree, figure for figure");
// =============================================================================

{
  const { roster, september } = completeSeptember();
  const { dashboard, report, publicView } = surfacesOf(
    roster,
    [september],
    september,
    { groupShiPct: 72, lastUpdatedAt: "2026-09-04T06:32:00Z" },
  );

  for (const tile of dashboard.kpis) {
    const mirrored = publicKpi(publicView, tile.key);

    check(
      `${tile.label}: dashboard = public share (${tile.value})`,
      mirrored.value === tile.value &&
        mirrored.label === tile.label &&
        mirrored.unit === tile.unit,
    );

    check(
      `${tile.label}: dashboard = WhatsApp (${tile.value})`,
      report.includes(tile.value),
    );
  }

  check(
    "group Net is one number across all three",
    (() => {
      const net = kpi(dashboard, "net").value;
      return (
        publicKpi(publicView, "net").value === net && report.includes(net)
      );
    })(),
  );

  for (const [index, week] of dashboard.weekly.weeks.entries()) {
    const mirrored = publicView.weekly.weeks[index];

    check(
      `${week.label}: units agree across dashboard and share`,
      mirrored?.unitsLabel === week.unitsLabel &&
        mirrored?.status === week.status,
    );

    check(
      `${week.label}: and the report carries the same figure`,
      !week.isEntered || report.includes(`${week.label} ${STATUS_EMOJI[week.status]} ${week.unitsLabel} units`),
    );
  }

  for (const [index, hm] of dashboard.hms.entries()) {
    const mirrored = publicView.hms[index];

    check(
      `${hm.name}: rank, Net, Key-In, Recruitment and Active HP all agree`,
      mirrored?.rank === hm.rank &&
        mirrored?.netLabel === hm.netLabel &&
        mirrored?.keyInLabel === hm.keyInLabel &&
        mirrored?.recruitmentLabel === hm.recruitmentLabel &&
        mirrored?.recruitmentStatus === hm.recruitmentStatus &&
        mirrored?.activeHpLabel === hm.activeHpLabel,
    );
  }

  check(
    "the weekly total agrees",
    publicView.weekly.totalLabel === dashboard.weekly.totalLabel &&
      report.includes(dashboard.weekly.totalLabel),
  );

  check(
    "and the group Key-In total is the sum of the weeks, not a stored field",
    kpi(dashboard, "keyIn").value ===
      formatUnits(
        september.weekly.reduce((total, row) => total + row.keyin_units, 0),
      ),
    kpi(dashboard, "keyIn").value,
  );
}

// =============================================================================
section("[18] the public route is bound to its token and reads nothing else");
// =============================================================================

{
  const page = read("app/share/[token]/page.tsx");

  check(
    "the page takes the token from the path",
    page.includes("props.params") && page.includes("token"),
  );

  check(
    "it reads NO search parameters, so `?month=` cannot override the binding",
    !page.includes("searchParams"),
  );

  check(
    "it resolves through the share data module and nothing else",
    page.includes("getPublicShareReport") &&
      !page.includes("getDashboardData") &&
      !page.includes("createSupabaseServerClient"),
  );

  check(
    "an unusable token is a 404 with a generic message",
    page.includes("notFound()"),
  );

  check(
    "it is never cached, so a revoked link stops working at once",
    page.includes('dynamic = "force-dynamic"'),
  );

  check(
    "no auth guard is called - this route deliberately has no session",
    !page.includes("requireAuth") && !page.includes("requirePaOrManager"),
  );

  const unavailable = readCode("components/share/share-unavailable.tsx");

  check(
    "the unavailable page gives one message for every failure",
    unavailable.includes("Report unavailable") &&
      !unavailable.includes("revoked") &&
      !unavailable.includes("expired") &&
      !unavailable.includes("not found"),
  );

  check(
    "and offers no route back into the application",
    !unavailable.includes("href") && !unavailable.includes("Link"),
  );

  const layout = readCode("app/share/layout.tsx");

  check(
    "the share layout carries no application chrome",
    !layout.includes("AppShell") &&
      !layout.includes("SidebarNav") &&
      !layout.includes("SignOutButton"),
  );

  check("and asks not to be indexed", layout.includes("robots"));

  const report = readCode("components/share/public-report.tsx");

  check(
    "the public report offers no month control",
    !report.includes("MonthSwitcher") &&
      !report.includes("month=") &&
      !report.includes("Previous month"),
  );

  check(
    "and no edit, refresh or sign-out control",
    !report.includes("RefreshButton") &&
      !report.includes("<button") &&
      !report.includes("SignOut"),
  );

  const card = readCode("components/share/share-hm-card.tsx");

  check(
    "the public HM card links nowhere - there is no public HM detail page",
    !card.includes("next/link") && !card.includes("hmDetailPath"),
  );
}

// =============================================================================
section("[19] the private routes stayed private");
// =============================================================================

{
  check(
    "/share is public",
    isPublicRoute("/share/abc") && PUBLIC_ROUTES.includes(ROUTES.share),
  );

  for (const route of [
    ROUTES.dashboard,
    ROUTES.hmDetail,
    ROUTES.dataEntry,
    ROUTES.hmManagement,
    ROUTES.settings,
  ]) {
    check(`${route} still requires a session`, !isPublicRoute(route));
  }

  check(
    "/hm/<id> is not public",
    !isPublicRoute("/hm/3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
  );

  check(
    "a path that merely starts with the word share is not public",
    !isPublicRoute("/shared-secrets"),
  );

  check(
    "sharePath builds /share/<token> and encodes it",
    sharePath("abc") === "/share/abc" &&
      sharePath("a/b").includes("%2F"),
  );

  check(
    "sharePath carries no month parameter",
    !sharePath("abc").includes("month"),
  );

  const dashboardPage = read("app/(app)/dashboard/page.tsx");

  check(
    "the dashboard still guards itself",
    dashboardPage.includes("requirePaOrManager()"),
  );

  const hmPage = read("app/(app)/hm/[hmId]/page.tsx");

  check("the HM screen still guards itself", hmPage.includes("requirePaOrManager()"));
}

// =============================================================================
section("[20] the server boundary: no service role, no raw rows, one query");
// =============================================================================

{
  const source = read("lib/data/share.ts");

  check("server-only", source.includes('import "server-only"'));

  check(
    "no service-role client anywhere on the share path",
    !source.includes("createSupabaseAdminClient") &&
      !source.includes("SERVICE_ROLE"),
  );

  check(
    "the public read is one RPC, not a table query",
    source.includes('supabase.rpc("resolve_share_report"') &&
      !source.match(/getPublicShareReport[\s\S]*?\.from\(/),
  );

  check(
    "the public path returns a projection, never the payload",
    source.includes("buildShareReport") && source.includes("parseSharePayload"),
  );

  // The pipeline itself lives in a pure module so it can be run against a real
  // payload from a real Postgres - see section [23].
  const resolver = readCode("lib/share/resolve.ts");

  check(
    "the resolver runs the same engine and presenter as the dashboard",
    resolver.includes("buildMonthlyPerformanceViewModel") &&
      resolver.includes("buildDashboardViewModel") &&
      resolver.includes("buildPublicShareViewModel"),
  );

  check(
    "the bundle holds exactly one month - the token's",
    resolver.includes("months: [") &&
      resolver.includes("selectedMonthId: payload.month.id"),
  );

  check(
    "and the resolver is pure - no Supabase, no next/headers, no React",
    !resolver.includes("supabase") &&
      !resolver.includes("next/headers") &&
      !resolver.includes("react"),
  );

  check(
    "a token that fails the shape gate never reaches the database",
    source.includes("isShareTokenShaped(token)"),
  );

  check(
    "a resolver error is logged, not shown, so it cannot become an oracle",
    source.includes("console.error") &&
      source.includes("This report is unavailable."),
  );

  const actions = read("lib/actions/share.ts");

  check(
    "generating a report requires an authenticated manager or PA",
    actions.includes("requirePaOrManager()"),
  );

  check(
    "revoking one does too",
    (actions.match(/requirePaOrManager\(\)/g) ?? []).length >= 2,
  );

  check(
    "the report is built with the same presenter the page uses",
    actions.includes("buildDashboardViewModel") &&
      actions.includes("generateWhatsAppReport"),
  );

  check(
    "links are reused rather than minted per click",
    source.includes("ensureShareLinkForMonth") &&
      source.includes("existing.data && !force"),
  );

  check(
    "revocation is an update, never a delete of the month's data",
    source.includes("is_active: false") &&
      !source.match(/revokeShareLink[\s\S]*?\.delete\(/),
  );

  check(
    "a revoke that touched no rows is reported as a failure, not a success",
    source.includes("data.length === 0"),
  );
}

// =============================================================================
section("[21] the migration draws the boundary it claims to");
// =============================================================================

{
  const sql = readMigration();

  check(
    "share_links is revoked from anon",
    sql.includes("revoke all on table public.share_links from anon"),
  );

  check(
    "no anon policy is created on any table",
    // Bounded to a single statement: `[^;]` cannot run past the semicolon that
    // ends one policy, so this cannot match the `to anon` in the final grant.
    !sql.match(/create policy[^;]*to anon/),
  );

  check(
    "no blanket grant to anon",
    !sql.match(/grant\s+select[^;]*to\s+anon/i),
  );

  check(
    "exactly one function is executable by anon",
    (sql.match(/to anon/g) ?? []).length === 1 &&
      sql.includes("grant execute on function public.resolve_share_report(text) to anon"),
  );

  check(
    "the resolver is security definer with a pinned search path",
    sql.includes("security definer") && sql.includes("set search_path = ''"),
  );

  check(
    "it returns null for every failure rather than distinguishing them",
    (sql.match(/return null;/g) ?? []).length >= 3,
  );

  check(
    "it checks active, revoked and expiry",
    sql.includes("not link.is_active") &&
      sql.includes("link.revoked_at is not null") &&
      sql.includes("link.expires_at <= now()"),
  );

  check(
    "the projection carries no created_by or updated_by",
    !sql.match(/'created_by'/) && !sql.match(/'updated_by'/),
  );

  check(
    "and no performance row ids",
    !sql.match(/'id',\s+p\.id/) && !sql.match(/'id',\s+k\.id/),
  );

  check(
    "nothing from profiles is projected",
    !sql.includes("public.profiles"),
  );

  check(
    "auth.users is referenced only as the created_by foreign key",
    (sql.match(/auth\.users/g) ?? []).length === 1 &&
      sql.includes("references auth.users (id)"),
  );

  check(
    "every sub-select is anchored to the token's month",
    (sql.match(/= m\.id/g) ?? []).length >= 5,
  );

  check(
    "a token cannot be repointed at another month after it is issued",
    sql.includes("tg_share_links_freeze_identity") &&
      sql.includes("cannot be repointed at another reporting month"),
  );

  check(
    "created_by is stamped from auth.uid(), not trusted from the client",
    sql.includes("new.created_by := coalesce((select auth.uid())"),
  );

  check(
    "the token column is unique, shaped and length-checked",
    sql.includes("unique (token)") &&
      sql.includes("share_links_token_shape") &&
      sql.includes("share_links_token_length"),
  );

  check(
    "a uuid is refused as a token by the database as well as by the app",
    sql.includes("share_links_token_not_uuid") &&
      sql.includes("or p_token ~*"),
  );

  check(
    "revocation and the active flag cannot disagree",
    sql.includes("share_links_revocation_consistent"),
  );

  check(
    "the access stamp is throttled rather than written on every view",
    sql.includes("interval '5 minutes'"),
  );

  check(
    "the token lookup is indexed",
    sql.includes("share_links_month_active_idx") &&
      sql.includes("unique (token)"),
  );
}

// =============================================================================
section("[22] the report reads as plain text on a phone");
// =============================================================================

{
  const { roster, september } = completeSeptember();
  const { report } = surfacesOf(roster, [september], september, {
    groupShiPct: 72,
  });

  check("no markdown table", !report.includes("|---") && !report.includes("---|"));
  check("no code fence", !report.includes("```"));
  check("no HTML", !/<[a-z][\s\S]*>/i.test(report));

  check(
    "sections are separated by a divider rule",
    (report.match(/━+/g) ?? []).length >= 4,
  );

  check(
    "the headline sections are all present",
    report.includes("📊 HM2 SALES PERFORMANCE") &&
      report.includes("🏆 GROUP PERFORMANCE") &&
      report.includes("📈 WEEKLY KEY-IN") &&
      report.includes("👥 HM PERFORMANCE"),
  );

  check(
    "no run of three or more blank lines",
    !report.includes("\n\n\n"),
  );

  check("no trailing whitespace at the end", report === report.trimEnd());

  check(
    "no raw database field name appears anywhere",
    !report.includes("net_units") &&
      !report.includes("hm_id") &&
      !report.includes("month_id") &&
      !report.includes("keyin_units") &&
      !report.includes("shi_percentage"),
  );

  check(
    "no uuid appears anywhere",
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(report),
  );
}

// =============================================================================
section("[23] end to end: a real token, a real Postgres, the real pipeline");
// =============================================================================
//
// Every other section on this page works from fixtures, and the SQL is proved
// separately in `supabase/tests/schema.test.mjs`. Neither covers the SEAM: the
// point where jsonb built by `resolve_share_report` becomes input to the
// calculation engine. That is where a fixture and production part company - a
// key spelled differently, a `numeric` arriving as a string, an empty
// collection coming back as null instead of [] - and none of it would show up
// until somebody opened a share link.
//
// So this boots a real Postgres (PGlite, in WebAssembly, no Docker), applies
// every migration, keys in a month, issues a token, calls the function as
// `anon`, and runs what comes back through the actual resolver.

{
  const SUPABASE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "supabase",
  );

  const db = await PGlite.create();

  await db.exec(
    readFileSync(path.join(SUPABASE, "tests", "bootstrap.sql"), "utf8"),
  );

  for (const file of readdirSync(path.join(SUPABASE, "migrations")).sort()) {
    await db.exec(
      readFileSync(path.join(SUPABASE, "migrations", file), "utf8"),
    );
  }

  const first = async (sql: string) => (await db.query(sql)).rows[0] as never;

  const month = (await first(
    `insert into public.months (year, month, label, quarter)
       values (2026, 9, '', 3) returning id`,
  )) as { id: string };

  // Two HMs with real figures, one active HM with nothing keyed in - so the
  // completeness model has something honest to report - and five irregular
  // Coway periods, the first opening in August.
  const alpha = (await first(
    `insert into public.hms (name, office, display_order)
       values ('Sample HM Alpha', 'Sample Office A', 1) returning id`,
  )) as { id: string };

  const bravo = (await first(
    `insert into public.hms (name, office, display_order)
       values ('Sample HM Bravo', 'Sample Office B', 2) returning id`,
  )) as { id: string };

  await db.exec(
    `insert into public.hms (name, office, display_order)
       values ('Sample HM Charlie', 'Sample Office C', 3)`,
  );

  const weekRanges = [
    ["2026-08-30", "2026-09-05"],
    ["2026-09-06", "2026-09-12"],
    ["2026-09-13", "2026-09-19"],
    ["2026-09-20", "2026-09-26"],
    ["2026-09-27", "2026-09-30"],
  ];

  const weekIds: string[] = [];

  for (const [index, [start, end]] of weekRanges.entries()) {
    const week = (await first(
      `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
         values ('${month.id}', ${index + 1}, '${start}', '${end}') returning id`,
    )) as { id: string };

    weekIds.push(week.id);
  }

  await db.exec(
    `insert into public.hm_monthly_performance
       (hm_id, month_id, net_units, target_net_units, recruitment, active_hp,
        shi_percentage, extrade_units, non_extrade_units)
     values
       ('${alpha.id}', '${month.id}', 76, 100, 6, 31, 88.00, 20, 56),
       ('${bravo.id}', '${month.id}', 58, 80, 2, 25, 92.00, 10, 48)`,
  );

  // W1-W4 keyed in for both; W5 left blank on purpose - the month is not over.
  const keyIn = [
    [alpha.id, [20, 18, 22, 16]],
    [bravo.id, [14, 15, 13, 11]],
  ] as const;

  for (const [hm, weeks] of keyIn) {
    for (const [index, units] of weeks.entries()) {
      await db.exec(
        `insert into public.hm_weekly_performance (hm_id, week_id, keyin_units)
           values ('${hm}', '${weekIds[index]}', ${units})`,
      );
    }
  }

  await db.exec(
    `insert into public.group_monthly_metrics (month_id, shi_percentage)
       values ('${month.id}', 72.00)`,
  );

  const token = generateShareToken();

  await db.exec(
    `insert into public.share_links (token, month_id)
       values ('${token}', '${month.id}')`,
  );

  // As anon, exactly as the public route does it.
  await db.exec(`set role anon`);
  const raw = (
    (await db.query(
      `select public.resolve_share_report('${token}') as body`,
    )) as { rows: { body: unknown }[] }
  ).rows[0]!.body;
  await db.exec(`reset role`);

  check("anon resolves the token against a real database", raw !== null);

  const payload = parseSharePayload(raw);

  check("the payload parses", payload !== null);

  const report = payload ? buildShareReport(payload) : null;

  check("and builds a report", report !== null);

  if (report && payload) {
    // The same month, built the way the DASHBOARD builds it, so the two can be
    // compared figure for figure across the SQL boundary.
    const performance = buildMonthlyPerformanceViewModel({
      selectedMonthId: payload.month.id,
      hms: payload.hms,
      months: [
        {
          month: payload.month,
          weeks: payload.weeks,
          monthly: payload.monthly,
          weekly: payload.weekly,
        },
      ],
      groupShiPct: Number(payload.groupShiPct),
    })!;

    const dashboard = buildDashboardViewModel({
      selectedMonth: payload.month,
      performance,
      lastUpdatedAt: payload.lastUpdatedAt,
    });

    const whatsapp = generateWhatsAppReport(dashboard, { shareUrl: SHARE_URL });

    check(
      "the month label survives the round trip",
      report.monthLabel === "September 2026",
      report.monthLabel,
    );

    check("and the quarter", report.quarterLabel === "Q3 2026");

    // 20+18+22+16 + 14+15+13+11 = 129. Written out because this is the one
    // place the whole chain - SQL, engine, presenter - is being checked against
    // an independently known truth rather than against itself.
    check(
      "group Key-In is the sum of the entered weeks (129)",
      publicKpi(report, "keyIn").value === formatUnits(129),
      publicKpi(report, "keyIn").value,
    );

    check(
      "group Net is 134",
      publicKpi(report, "net").value === formatUnits(134),
      publicKpi(report, "net").value,
    );

    check(
      "group Target is 180",
      publicKpi(report, "target").value === formatUnits(180),
      publicKpi(report, "target").value,
    );

    check(
      "Achievement is 74.4%, from the engine",
      publicKpi(report, "achievement").value === formatPercentage((134 / 180) * 100),
      publicKpi(report, "achievement").value,
    );

    check(
      "Net ratio is Net over Key-In",
      publicKpi(report, "netRatio").value === formatPercentage((134 / 129) * 100),
      publicKpi(report, "netRatio").value,
    );

    // numeric(5,2) is the column type; whether it arrives as 72.00, "72.00" or
    // 72 depends on the driver, and this is the assertion that catches it.
    check(
      "Group SHI survives numeric -> json as 72.0%",
      publicKpi(report, "shi").value === formatPercentage(72),
      `${publicKpi(report, "shi").value} (raw ${JSON.stringify(payload.groupShiPct)})`,
    );

    check(
      "recruitment totals 8",
      publicKpi(report, "recruitment").value === formatUnits(8),
      publicKpi(report, "recruitment").value,
    );

    check(
      "Active HP totals 56",
      publicKpi(report, "activeHp").value === formatUnits(56),
      publicKpi(report, "activeHp").value,
    );

    check(
      "five weeks come back, in order",
      report.weekly.weeks.map((week) => week.label).join(",") ===
        "W1,W2,W3,W4,W5",
      report.weekly.weeks.map((week) => week.label).join(","),
    );

    check(
      "W1 totals 34 across both HMs",
      report.weekly.weeks[0]?.unitsLabel === formatUnits(34),
      report.weekly.weeks[0]?.unitsLabel,
    );

    check(
      "W5, never keyed in, is blank and neutral - not a zero week",
      report.weekly.weeks[4]?.isEntered === false &&
        report.weekly.weeks[4]?.unitsLabel === "—" &&
        report.weekly.weeks[4]?.status === "neutral",
    );

    check(
      "the sales week dates are the Coway periods, not derived from the month",
      report.weekly.weeks[0]?.rangeLabel === "30 Aug – 5 Sep",
      report.weekly.weeks[0]?.rangeLabel,
    );

    check(
      "the HMs are ranked by Net, Alpha ahead of Bravo",
      report.hms.map((hm) => hm.name).join(",") ===
        "Sample HM Alpha,Sample HM Bravo,Sample HM Charlie",
      report.hms.map((hm) => hm.name).join(","),
    );

    check(
      "the HM with nothing keyed in is present and marked as such",
      report.hms[2]?.hasMonthlyRecord === false &&
        report.hms[2]?.netLabel === "—",
    );

    check(
      "completeness reports two of three",
      report.completeness.headline === "2 of 3 HMs updated",
      report.completeness.headline,
    );

    check(
      "and names who is outstanding",
      report.completeness.detail?.includes("Sample HM Charlie") === true,
      report.completeness.detail ?? "none",
    );

    check(
      "the Updated stamp is the data's own, from SQL",
      typeof payload.lastUpdatedAt === "string" &&
        report.updatedLabel !== null,
      `${payload.lastUpdatedAt} -> ${report.updatedLabel}`,
    );

    // ---- the three surfaces, across the SQL boundary ------------------------
    for (const tile of dashboard.kpis) {
      check(
        `${tile.label}: dashboard = share = WhatsApp, from real records (${tile.value})`,
        publicKpi(report, tile.key).value === tile.value &&
          whatsapp.includes(tile.value),
      );
    }

    check(
      "no NaN, Infinity, undefined or null in the message",
      !whatsapp.includes("NaN") &&
        !whatsapp.includes("Infinity") &&
        !whatsapp.includes("undefined") &&
        !whatsapp.includes("null"),
    );

    check(
      "and no database field name or uuid in it",
      !whatsapp.includes("net_units") &&
        !whatsapp.includes("shi_percentage") &&
        !whatsapp.includes(month.id) &&
        !whatsapp.includes(alpha.id),
    );

    const serialised = JSON.stringify(report);

    check(
      "the public model carries no created_by or updated_by from the real rows",
      !serialised.includes("created_by") && !serialised.includes("updated_by"),
    );

    check(
      "and no real database id",
      !serialised.includes(month.id) &&
        !serialised.includes(alpha.id) &&
        !serialised.includes(weekIds[0]!),
    );

    check(
      "and not the token that produced it",
      !serialised.includes(token),
    );
  }

  // ---- revocation, through the real function -------------------------------
  await db.exec(
    `update public.share_links set is_active = false, revoked_at = now()
       where token = '${token}'`,
  );

  await db.exec(`set role anon`);
  const afterRevoke = (
    (await db.query(
      `select public.resolve_share_report('${token}') as body`,
    )) as { rows: { body: unknown }[] }
  ).rows[0]!.body;
  await db.exec(`reset role`);

  check("a revoked token resolves to nothing", afterRevoke === null);

  check(
    "and the resolver refuses to build a report from it",
    parseSharePayload(afterRevoke) === null,
  );

  // ---- a fresh token for the same month still works ------------------------
  const replacement = generateShareToken();

  await db.exec(
    `insert into public.share_links (token, month_id)
       values ('${replacement}', '${month.id}')`,
  );

  await db.exec(`set role anon`);
  const reissued = (
    (await db.query(
      `select public.resolve_share_report('${replacement}') as body`,
    )) as { rows: { body: unknown }[] }
  ).rows[0]!.body;
  await db.exec(`reset role`);

  const reissuedReport = buildShareReport(parseSharePayload(reissued)!);

  check(
    "a newly issued token for the same month works, and shows the same month",
    reissuedReport?.monthLabel === "September 2026",
  );

  check(
    "revoking the first link changed no figure",
    reissuedReport !== null &&
      publicKpi(reissuedReport, "net").value === formatUnits(134),
  );

  // ---- a correction shows up on the SAME link: live, not a snapshot ---------
  await db.exec(
    `update public.hm_monthly_performance
        set net_units = 80, non_extrade_units = 60
      where hm_id = '${alpha.id}' and month_id = '${month.id}'`,
  );

  await db.exec(`set role anon`);
  const afterEdit = (
    (await db.query(
      `select public.resolve_share_report('${replacement}') as body`,
    )) as { rows: { body: unknown }[] }
  ).rows[0]!.body;
  await db.exec(`reset role`);

  const updated = buildShareReport(parseSharePayload(afterEdit)!);

  check(
    "a figure corrected after the link was shared shows on that same link",
    updated !== null && publicKpi(updated, "net").value === formatUnits(138),
    updated ? publicKpi(updated, "net").value : "no report",
  );

  await db.close();
}

// =============================================================================
section("[24] the share URL is built against the configured origin");
// =============================================================================
//
// The one URL this application produces that has to work somewhere else. It is
// pasted into a WhatsApp group and opened on a phone on another network, so
// "nearly right" is indistinguishable from broken - and the person who finds
// out is a recipient, not the PA who sent it.

{
  const TOKEN = generateShareToken();
  const PATH = sharePath(TOKEN);

  const urlFor = (origin: Parameters<typeof resolveAppOrigin>[0]) =>
    joinUrl(resolveAppOrigin(origin), PATH);

  // ---- a configured production origin --------------------------------------
  check(
    "NEXT_PUBLIC_APP_URL=https://example.com -> https://example.com/share/<token>",
    urlFor({ configured: "https://example.com" }) ===
      `https://example.com/share/${TOKEN}`,
    urlFor({ configured: "https://example.com" }),
  );

  check(
    "a trailing slash does not produce a double slash",
    urlFor({ configured: "https://example.com/" }) ===
      `https://example.com/share/${TOKEN}`,
    urlFor({ configured: "https://example.com/" }),
  );

  check(
    "and neither do several",
    urlFor({ configured: "https://example.com///" }) ===
      `https://example.com/share/${TOKEN}`,
    urlFor({ configured: "https://example.com///" }),
  );

  check(
    "surrounding whitespace in the variable is tolerated",
    normalizeAppUrl("  https://example.com/  ") === "https://example.com",
    String(normalizeAppUrl("  https://example.com/  ")),
  );

  check(
    "a non-default port survives - a staging deployment keeps it",
    normalizeAppUrl("https://staging.example.com:8443/") ===
      "https://staging.example.com:8443",
    String(normalizeAppUrl("https://staging.example.com:8443/")),
  );

  check(
    "a base path is kept, and joined with exactly one slash",
    urlFor({ configured: "https://example.com/hm2/" }) ===
      `https://example.com/hm2/share/${TOKEN}`,
    urlFor({ configured: "https://example.com/hm2/" }),
  );

  // ---- the configured value cannot smuggle a share target ------------------
  check(
    "a query string on the configured origin is dropped, not prepended",
    normalizeAppUrl("https://example.com/?month=2025-01") === "https://example.com",
    String(normalizeAppUrl("https://example.com/?month=2025-01")),
  );

  check(
    "and so is a fragment",
    normalizeAppUrl("https://example.com/#anywhere") === "https://example.com",
    String(normalizeAppUrl("https://example.com/#anywhere")),
  );

  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<h1>hi</h1>",
    "ftp://example.com",
    "file:///etc/passwd",
    "example.com",
    "//example.com",
    "not a url",
    "",
    "   ",
  ]) {
    check(
      `${JSON.stringify(bad)} is refused as an app URL`,
      normalizeAppUrl(bad) === null,
      String(normalizeAppUrl(bad)),
    );
  }

  check("an unset variable is refused too", normalizeAppUrl(undefined) === null);
  check("and a null one", normalizeAppUrl(null) === null);

  // ---- the same value decides the session cookie's Secure flag (Stage 7) ---
  //
  // `@supabase/ssr` ships the auth cookie as `path=/; SameSite=Lax` with no
  // `Secure`. `lib/env.ts` supplies one, derived from this variable, to both
  // Supabase clients. The direction of the default matters more than the
  // predicate: a `Secure` cookie on a plaintext origin is DROPPED by the
  // browser, so anything unparseable has to come back false or every login in
  // development loops.

  for (const secure of [
    "https://hm2.example.com",
    "https://hm2.example.com/",
    "  https://hm2.example.com  ",
    "https://staging.example.com:8443",
    "HTTPS://hm2.example.com",
  ]) {
    check(
      `${JSON.stringify(secure)} marks the session cookie Secure`,
      isHttpsAppUrl(secure) === true,
      String(isHttpsAppUrl(secure)),
    );
  }

  for (const insecure of [
    "http://localhost:3000",
    "http://hm2.internal",
    "javascript:alert(1)",
    "example.com",
    "not a url",
    "",
    "   ",
  ]) {
    check(
      `${JSON.stringify(insecure)} does NOT mark it Secure`,
      isHttpsAppUrl(insecure) === false,
      String(isHttpsAppUrl(insecure)),
    );
  }

  check("an unset APP URL does not mark it Secure", isHttpsAppUrl(undefined) === false);
  check("nor does a null one", isHttpsAppUrl(null) === false);

  // ---- the development fallback -------------------------------------------
  check(
    "with no APP URL, a local host falls back to http://localhost:3000",
    resolveAppOrigin({ configured: "", host: "localhost:3000" }) ===
      "http://localhost:3000",
    String(resolveAppOrigin({ configured: "", host: "localhost:3000" })),
  );

  check(
    "and builds the same share path against it",
    urlFor({ host: "localhost:3000" }) ===
      `http://localhost:3000/share/${TOKEN}`,
    urlFor({ host: "localhost:3000" }),
  );

  check(
    "127.0.0.1 is local as well",
    resolveAppOrigin({ host: "127.0.0.1:3000" }) === "http://127.0.0.1:3000",
    String(resolveAppOrigin({ host: "127.0.0.1:3000" })),
  );

  check(
    "a non-local host with no forwarded proto is assumed https",
    resolveAppOrigin({ host: "hm2.example.com" }) === "https://hm2.example.com",
    String(resolveAppOrigin({ host: "hm2.example.com" })),
  );

  check(
    "x-forwarded-host wins over host, so a tunnel gets the outside address",
    resolveAppOrigin({
      host: "localhost:3000",
      forwardedHost: "hm2.example.com",
      forwardedProto: "https",
    }) === "https://hm2.example.com",
  );

  check(
    "a comma-separated forwarded proto takes the first hop",
    resolveAppOrigin({
      host: "hm2.example.com",
      forwardedProto: "https,http",
    }) === "https://hm2.example.com",
  );

  check(
    "a forwarded host carrying a path is refused rather than repaired",
    resolveAppOrigin({ forwardedHost: "evil.example.com/share/x" }) === null,
    String(resolveAppOrigin({ forwardedHost: "evil.example.com/share/x" })),
  );

  check(
    "so is one carrying credentials or a scheme",
    resolveAppOrigin({ forwardedHost: "https://evil.example.com" }) === null &&
      resolveAppOrigin({ forwardedHost: "user@evil.example.com" }) === null,
  );

  check(
    "with neither a configured URL nor a host, there is no origin",
    resolveAppOrigin({}) === null,
  );

  check(
    "and the share link stays relative rather than pointing nowhere",
    joinUrl(null, PATH) === PATH,
  );

  // ---- configuration beats the request, always ----------------------------
  check(
    "a poisoned forwarded host cannot override a configured APP URL",
    urlFor({
      configured: "https://hm2.example.com",
      host: "localhost:3000",
      forwardedHost: "evil.example.com",
      forwardedProto: "http",
    }) === `https://hm2.example.com/share/${TOKEN}`,
  );

  check(
    "the built URL carries the token and nothing else",
    !urlFor({ configured: "https://example.com" }).includes("?") &&
      !urlFor({ configured: "https://example.com" }).includes("#"),
  );

  // ---- the wiring ---------------------------------------------------------
  const origin = readCode("lib/share/origin.ts");

  check(
    "the server wrapper delegates to the pure module rather than repeating it",
    origin.includes("resolveAppOrigin") && origin.includes("joinUrl"),
  );

  check(
    "NEXT_PUBLIC_APP_URL is read as a whole literal so Next.js can inline it",
    origin.includes("process.env.NEXT_PUBLIC_APP_URL"),
  );

  const urlModule = readCode("lib/share/url.ts");

  check(
    "the URL rules are pure - no next/headers, no env, no server-only",
    !urlModule.includes("next/headers") &&
      !urlModule.includes("process.env") &&
      !urlModule.includes("server-only"),
  );

  const shareActions = readCode("lib/actions/share.ts");

  check(
    "the action builds the share URL through absoluteUrl, not by hand",
    shareActions.includes("absoluteUrl(sharePath(") &&
      !shareActions.includes("http://localhost"),
  );

  check(
    "no production domain is hardcoded on the share path",
    ["lib/share/url.ts", "lib/share/origin.ts", "lib/actions/share.ts", "lib/routes.ts"]
      .map(readCode)
      .every(
        (source) =>
          !/https?:\/\/(?!hm2\.example\.com|example\.com|localhost|127\.0\.0\.1)[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(
            source,
          ),
      ),
  );

  // ---- it is documented, and the example file offers it -------------------
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );

  const envExample = readFileSync(path.join(root, ".env.example"), "utf8");

  check(
    ".env.example declares NEXT_PUBLIC_APP_URL",
    /^NEXT_PUBLIC_APP_URL=\s*$/m.test(envExample),
  );

  check(
    "and explains that it is set in production and blank locally",
    /production/i.test(envExample) && /development/i.test(envExample),
  );

  const readme = readFileSync(path.join(root, "README.md"), "utf8");

  check(
    "the README lists NEXT_PUBLIC_APP_URL as required in production",
    readme.includes("NEXT_PUBLIC_APP_URL"),
  );

  check(
    "and states what a missing one falls back to",
    /NEXT_PUBLIC_APP_URL[\s\S]{0,2000}?forwarded|forwarded[\s\S]{0,2000}?NEXT_PUBLIC_APP_URL/i.test(
      readme,
    ),
  );

  check(
    "the README invents no production domain",
    !/https:\/\/(?!hm2\.example\.com|example\.com|supabase\.com|localhost)[a-z0-9-]+\.(com|net|org|io|my)/i.test(
      readme,
    ),
  );
}

// =============================================================================
section("[25] the link list is state the panel owns, and it never goes stale");
// =============================================================================
//
// The failure this replaces: the table held `useState(initialLinks)`, so the
// initialiser ran once. Creating a link wrote the row, the action handed back
// the fresh list, and the table went on drawing the list it had mounted with -
// correct in the database, wrong on screen, until a full page reload.

{
  const link = (
    id: string,
    over: Partial<ShareLinkSummary> = {},
  ): ShareLinkSummary => ({
    id,
    token: `token-${id}`,
    monthId: "month-1",
    monthLabel: "September 2026",
    createdAt: "2026-09-04T09:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    isActive: true,
    lastAccessedAt: null,
    ...over,
  });

  const revokedForm = (source: ShareLinkSummary): ShareLinkSummary => ({
    ...source,
    isActive: false,
    revokedAt: "2026-09-19T09:00:00.000Z",
  });

  const counts = (links: ShareLinkSummary[]) =>
    JSON.stringify(countShareLinks(links));

  // ---- create: the returned list IS the state -----------------------------
  const before = [link("a")];

  check(
    "one active link to begin with",
    counts(before) === JSON.stringify({ total: 1, active: 1, revoked: 0 }),
    counts(before),
  );

  // What the action returns after "Create a new link": rotation revokes the old
  // link and inserts a new one, so BOTH rows changed and the server sends the
  // whole list. This is the exact scenario reported - 1 active before, and
  // 2 links / 1 active / 1 revoked after, with no reload.
  const afterCreate: ShareLinkSummary[] = [link("b"), revokedForm(link("a"))];

  check(
    "after Create a new link the list holds two rows",
    countShareLinks(afterCreate).total === 2,
    counts(afterCreate),
  );

  check(
    "one active, one revoked - the counts move with the rows",
    counts(afterCreate) === JSON.stringify({ total: 2, active: 1, revoked: 1 }),
    counts(afterCreate),
  );

  check(
    "the newly created link is present and active",
    afterCreate.some((row) => row.id === "b" && row.isActive),
  );

  check(
    "the rotated-out link is present and revoked, not removed",
    afterCreate.some((row) => row.id === "a" && !row.isActive),
  );

  check(
    "no duplicate rows: every id appears once",
    new Set(afterCreate.map((row) => row.id)).size === afterCreate.length,
  );

  check(
    "the panel stops offering the rotated-out link",
    isTokenRevoked(afterCreate, "token-a"),
  );

  check("and does offer the new one", !isTokenRevoked(afterCreate, "token-b"));

  // ---- revoke: the returned row updates its own row, in place -------------
  const list = [link("c"), link("b"), revokedForm(link("a"))];
  const afterRevoke = applyRevokedLink(list, revokedForm(link("b")));

  check(
    "revoking updates that row",
    afterRevoke.find((row) => row.id === "b")?.isActive === false,
  );

  check(
    "and stamps it from the server's own value",
    afterRevoke.find((row) => row.id === "b")?.revokedAt ===
      "2026-09-19T09:00:00.000Z",
  );

  check(
    "the row keeps its place - revoking created nothing to re-sort",
    afterRevoke.map((row) => row.id).join(",") === "c,b,a",
    afterRevoke.map((row) => row.id).join(","),
  );

  check("no row is added or dropped", afterRevoke.length === list.length);

  check(
    "the counts follow immediately: 3 total, 1 active, 2 revoked",
    counts(afterRevoke) === JSON.stringify({ total: 3, active: 1, revoked: 2 }),
    counts(afterRevoke),
  );

  check(
    "the other rows are untouched",
    afterRevoke.find((row) => row.id === "c")?.isActive === true &&
      afterRevoke.find((row) => row.id === "a")?.isActive === false,
  );

  check(
    "the input list is not mutated",
    list.find((row) => row.id === "b")?.isActive === true,
  );

  check(
    "an already-revoked row revoked again stays one row",
    applyRevokedLink(afterRevoke, revokedForm(link("b"))).length === 3,
  );

  check(
    "a row the list has never seen is ignored rather than appended",
    applyRevokedLink(afterRevoke, revokedForm(link("zzz"))).length === 3,
  );

  // ---- create after revoke ------------------------------------------------
  // The old link must stay revoked; the new one must arrive active.
  const revokedAll = afterRevoke.map((row) =>
    row.isActive ? revokedForm(row) : row,
  );

  check(
    "with everything revoked, nothing reads as active",
    countShareLinks(revokedAll).active === 0,
    counts(revokedAll),
  );

  const afterRecreate = [link("d"), ...revokedAll];

  check(
    "creating again adds exactly one row",
    afterRecreate.length === revokedAll.length + 1,
  );

  check(
    "the new link is active",
    afterRecreate[0]?.id === "d" && afterRecreate[0]?.isActive === true,
  );

  check(
    "and every previously revoked link stayed revoked",
    afterRecreate.filter((row) => row.id !== "d").every((row) => !row.isActive),
  );

  check(
    "counts: 4 total, 1 active, 3 revoked",
    counts(afterRecreate) === JSON.stringify({ total: 4, active: 1, revoked: 3 }),
    counts(afterRecreate),
  );

  check(
    "still no duplicates",
    new Set(afterRecreate.map((row) => row.id)).size === afterRecreate.length,
  );

  check(
    "an empty list counts as empty rather than throwing",
    counts([]) === JSON.stringify({ total: 0, active: 0, revoked: 0 }),
  );

  check(
    "a token the list does not contain is not reported as revoked",
    !isTokenRevoked(afterRecreate, "token-never-issued"),
  );

  // ---- the component wires it up that way ---------------------------------
  const panel = readCode("components/dashboard/whatsapp-report.tsx");

  check(
    "the list is owned by the panel, not initialised inside the table",
    panel.includes("useState<ShareLinkSummary[]>([])") &&
      !panel.includes("useState(initialLinks)"),
  );

  check(
    "a successful generate re-seeds the list from the server's own result",
    panel.includes("setLinks(result.payload.links)"),
  );

  check(
    "a revoke folds in the returned row rather than re-reading the list",
    panel.includes("applyRevokedLink(current, revoked)") &&
      !panel.includes("listShareLinksAction"),
  );

  check(
    "the counts on screen are derived from the rows on screen",
    panel.includes("countShareLinks(links)"),
  );

  check(
    "whether the current link is revoked is derived, not a second state",
    panel.includes("isTokenRevoked(links, payload.token)") &&
      !panel.includes("setCurrentRevoked"),
  );

  check(
    "nothing is invented client-side: no optimistic row is constructed",
    !panel.match(/isActive:\s*(true|false)/) && !panel.includes("revokedAt:"),
  );

  check(
    "and the panel never reloads the page to see its own write",
    !panel.includes("location.reload") && !panel.includes("router.refresh"),
  );

  const shareActions = readCode("lib/actions/share.ts");

  check(
    "the revoke action returns the revoked link for the client to apply",
    shareActions.includes("link: revoked.data") &&
      shareActions.includes("ShareLinkState"),
  );

  check(
    "and it is still a projection - no raw row reaches the client",
    shareActions.includes("ShareLinkSummary") &&
      !shareActions.includes("month_id") &&
      !shareActions.includes("created_by"),
  );

  check(
    "the list action was removed rather than left as an unused endpoint",
    !shareActions.includes("listShareLinksAction"),
  );

  const shareData = readCode("lib/data/share.ts");

  check(
    "revokeShareLink returns the updated row from the same statement",
    shareData.includes("Promise<Result<ShareLinkSummary>>") &&
      shareData.includes("toSummary(data[0] as ShareLinkRow)"),
  );

  check(
    "a revoke that touched no rows is still reported as a failure",
    shareData.includes("data.length === 0"),
  );

  const model = readCode("lib/share/link-list.ts");

  check(
    "the list model is pure - no React, no Supabase, no fetching",
    !model.includes("useState") &&
      !model.includes("supabase") &&
      !model.includes("fetch("),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
