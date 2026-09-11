import {
  formatPercentage,
  formatSignedPercentage,
  formatSignedUnits,
  formatUnits,
  getKeyInStatus,
  hasKeyInThreshold,
  keyInAchievement,
  type Entry,
  type GroupMonthlyCalculatedPerformance,
  type HmKpiKey,
  type HmKpiStatuses,
  type KeyInKpiStatus,
  type KpiStatus,
  type ManagementAttentionEntry,
  type MetricMonthOverMonth,
  type Percentage,
  type PerformanceStatus,
  type QtdPerformance,
} from "@/lib/calculations";
import {
  formatUpdatedAt,
  formatWeekRange,
  monthLabel,
  monthParam,
} from "@/lib/calendar";
import { hmDetailPath, hpListingPath } from "@/lib/routes";
import { formatMonthLabel } from "@/lib/validation/month";
import type { MonthlyPerformanceViewModel } from "@/lib/view-models/monthly-performance";
import type { Month } from "@/types/models";

/**
 * The dashboard presenter.
 *
 * ---------------------------------------------------------------------------
 *   lib/calculations  ->  monthly-performance  ->  THIS FILE  ->  components
 * ---------------------------------------------------------------------------
 *
 * Everything below is SELECTION and FORMATTING. It decides which already
 * calculated figure belongs on which card and what it reads as on screen; it
 * does not decide what any figure IS. There is no arithmetic here beyond
 * scaling a bar to the width of its track, and deliberately no division of one
 * business figure by another anywhere in the file.
 *
 * It exists so the dashboard components can be pure layout. A component that
 * needs Achievement reads `kpi.value`; it never sees `totalNet` and
 * `totalTarget` in the same scope, so it cannot be tempted to divide them.
 *
 * It also makes the dashboard testable without a DOM: a test asserts that the
 * tile carrying Achievement carries the ENGINE's Achievement, which is the
 * thing that can actually break. Re-deriving 86.2% inside a test would only
 * prove that the test can divide.
 *
 * Pure: no React, no Supabase, no clock. The "updated" stamp is passed in.
 */

/** What a figure reads as when it has not been entered. Never "0". */
export const NO_VALUE = "—";

// -----------------------------------------------------------------------------
// KPI status (Stage 9)
// -----------------------------------------------------------------------------

/**
 * The three bands, in the words a manager reads.
 *
 * The one place a `KpiStatus` becomes English. Nothing in the engine, and
 * nothing in a component, compares against these strings - they exist to be
 * rendered, so the wording can change without touching a threshold.
 *
 * Deliberately the business's own vocabulary. "Needs Attention" is a statement
 * about pace right now; "Will Miss", "Forecast" or "Probability" would be
 * claims about the future that this feature does not make.
 */
export const KPI_STATUS_LABELS: Record<KpiStatus, string> = {
  needs_attention: "Needs Attention",
  watch: "Watch",
  on_track: "On Track",
};

/** The KPI names, for the Management Attention list. */
export const KPI_LABELS: Record<HmKpiKey, string> = {
  keyIn: "Key-In",
  net: "Net",
  recruitment: "Recruitment",
  activeHp: "Active HP",
};

/**
 * One KPI's band, ready to render.
 *
 * `status` is `null` whenever no band can be stated, and `label` then says
 * WHICH kind of nothing it is - "Not entered", "Not configured", "No target".
 * A screen showing a bare em dash for all three would leave a manager unable to
 * tell a week the business has no rule for from one the PA has not keyed in.
 */
export type KpiStatusModel = {
  status: KpiStatus | null;
  /** "On Track", or the reason there is no band. Never colour alone. */
  label: string;
  /** The arithmetic behind the band, when there is any worth showing. */
  note: string | null;
};

/** "On Track" and friends, or the neutral word for a KPI with no band. */
export function kpiStatusLabel(status: KpiStatus | null): string {
  return status === null ? "No status" : KPI_STATUS_LABELS[status];
}

/**
 * The Key-In band, with the week and the arithmetic that produced it.
 *
 * The note is the point of this model. The status is measured against the
 * CURRENT week's Key-In as a share of the MONTHLY target, while the figure on
 * the card beside it is the month's Key-In so far - two different numbers, and
 * a badge with no explanation would look like it described the one above it.
 * "W2: 27 of 100 target · 27.0%" says exactly what was banded.
 */
export function buildKeyInStatusModel(keyIn: KeyInKpiStatus): KpiStatusModel {
  const week = keyIn.weekLabel;

  if (week === null) {
    return {
      status: null,
      label: "No status",
      note: "No sales weeks configured",
    };
  }

  // W5 and W6. The business has defined no band for them, so none is invented -
  // the figures stay visible, the status says it is not configured.
  if (!keyIn.hasThreshold) {
    return {
      status: null,
      label: "Not configured",
      note: `${week} has no defined threshold`,
    };
  }

  if (!keyIn.isEntered) {
    return {
      status: null,
      label: "Not entered",
      note: `${week} not entered yet`,
    };
  }

  const units = formatUnits(keyIn.keyInUnits);

  if (keyIn.targetUnits === null || keyIn.targetUnits <= 0) {
    return {
      status: null,
      label: "No target",
      note: `${week}: ${units} · target not set`,
    };
  }

  return {
    status: keyIn.status,
    label: kpiStatusLabel(keyIn.status),
    note: `${week}: ${units} of ${formatUnits(keyIn.targetUnits)} target · ${formatPercentage(
      keyIn.achievementPct,
      { fallback: NO_VALUE },
    )}`,
  };
}

/** A band with no arithmetic worth restating - the figure beside it is the whole story. */
function plainStatusModel(
  status: KpiStatus | null,
  missingLabel: string,
  note: string | null = null,
): KpiStatusModel {
  return status === null
    ? { status: null, label: missingLabel, note }
    : { status, label: kpiStatusLabel(status), note };
}

/** The four bands for one HM, in the order every surface shows them. */
export type HmKpiStatusModels = {
  keyIn: KpiStatusModel;
  net: KpiStatusModel;
  recruitment: KpiStatusModel;
  activeHp: KpiStatusModel;
};

/**
 * The four bands, formatted - and kept as four.
 *
 * There is no combined figure here, and there is not going to be one. Key-In on
 * track and Recruitment in the red is a specific, actionable thing to say; an
 * average of the two is not.
 */
export function buildHmKpiStatusModels(
  statuses: HmKpiStatuses,
  netRatioPct: Percentage,
): HmKpiStatusModels {
  return {
    keyIn: buildKeyInStatusModel(statuses.keyIn),
    net: plainStatusModel(
      statuses.net,
      "Not entered",
      // Blank when the ratio cannot be calculated: an HM with Net entered and
      // nothing keyed in is Needs Attention by the business's own rule, and the
      // ratio beside it is genuinely unknown rather than 0%.
      netRatioPct === null
        ? "Net ratio unavailable"
        : `${formatPercentage(netRatioPct, { fallback: NO_VALUE })} of Key-In`,
    ),
    recruitment: plainStatusModel(statuses.recruitment, "Not entered"),
    activeHp: plainStatusModel(statuses.activeHp, "No HP data"),
  };
}

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

export type KpiKey =
  | "keyIn"
  | "net"
  | "target"
  | "achievement"
  | "recruitment"
  | "activeHp"
  | "netRatio"
  | "shi";

export type KpiTile = {
  key: KpiKey;
  label: string;
  /**
   * Where the figure came from, when there is somewhere to look.
   *
   * Only Active HP has one today: it is a COUNT of rows the manager can go and
   * read, and "96 active" invites "which 96". Built here rather than in the
   * card so the link always carries the month that produced the number - a
   * figure that opened a different month's list would be worse than no link.
   */
  href?: string | null;
  /** Already formatted, blanks included. A component renders it as-is. */
  value: string;
  /**
   * "units" and the like, or `null` when the figure carries its own - and also
   * `null` when the figure is blank, because "— units" reads as a broken
   * number rather than as a missing one.
   */
  unit: string | null;
  /** One short line under the number when there is no unit to show. */
  note: string | null;
};

export type TargetProgressModel = {
  netLabel: string;
  targetLabel: string;
  achievementLabel: string;
  /**
   * Bar width, 0-100, or `null` when there is no target to draw against.
   *
   * Clamped: 118% achievement fills the track and the real figure is shown in
   * text beside it, because a bar overflowing its track reads as a rendering
   * bug rather than as good news. The clamp is presentation only and never
   * touches `achievementLabel`, which always shows what was achieved.
   */
  progressPct: number | null;
  hasTarget: boolean;
};

export type WeeklyBar = {
  weekId: string;
  /** "W1", from the sales calendar - never derived from the dates. */
  label: string;
  /** "30 Aug – 5 Sep", the official Coway period. */
  rangeLabel: string;
  units: Entry;
  unitsLabel: string;
  /** The engine's locked band. A blank week is neutral, never red. */
  status: PerformanceStatus;
  isEntered: boolean;
  /** Height of the bar as a share of the tallest entered week, 0-100. */
  barPct: number;
  /** HMs who have keyed this week in. */
  hmsEntered: number;
  /**
   * The Stage 9 pacing band for this week: the GROUP's Key-In for it as a share
   * of the GROUP's monthly target, against that week's threshold.
   *
   * Off the group totals, exactly like every other group percentage in this
   * application - never the average of the HM bands, which would weight an HM
   * with a target of 20 the same as one with a target of 200. `null` for a week
   * with no defined threshold (W5/W6), a week nobody has entered, or a month
   * with no target set.
   */
  kpiStatus: KpiStatusModel;
};

export type WeeklyChartModel = {
  weeks: WeeklyBar[];
  /** False when the Coway periods have not been configured for this month. */
  hasWeeks: boolean;
  /** False when no week holds a single figure yet. */
  hasEntries: boolean;
  weeksEntered: number;
  weeksConfigured: number;
  totalLabel: string;
};

export type HmCardModel = {
  rank: number;
  hmId: string;
  /** The Coway identifier, shown under the name. Secondary, never hidden. */
  hmCode: string;
  /**
   * The HM's own screen, with the reporting month carried across.
   *
   * Built here rather than in the card so the month cannot be dropped on the
   * way: a card that linked to `/hm/<id>` alone would land the manager
   * on today's month while they were plainly looking at August.
   */
  href: string;
  name: string;
  office: string;
  photoUrl: string | null;
  isActive: boolean;
  netLabel: string;
  keyInLabel: string;
  recruitmentLabel: string;
  recruitmentStatus: PerformanceStatus;
  activeHpLabel: string;
  /**
   * That HM's active HPs for this month, or `null` when there is no figure.
   *
   * The card's Active HP number is a link because the question it provokes -
   * "which of my HPs are those?" - has an answer one click away. Built here so
   * it carries the HM and the month together; a link that dropped either would
   * open a list that does not match the number that was clicked.
   */
  activeHpHref: string | null;
  targetLabel: string;
  achievementLabel: string;
  progressPct: number | null;
  hasTarget: boolean;
  /** False when the PA has not keyed this HM in for the month at all. */
  hasMonthlyRecord: boolean;
  /**
   * The Stage 9 pacing bands, one per KPI, already in words.
   *
   * Four separate bands and no fifth combined one: the card's job is to say
   * WHICH figure needs a conversation, and an overall score would take exactly
   * that away.
   *
   * `recruitmentStatus` above is a different, older thing and is deliberately
   * left alone - it is the Stage 2 colour band that the data-entry grid, the
   * WhatsApp report and the shared report all still read.
   */
  statuses: HmKpiStatusModels;
};

export type CompletenessModel = {
  level: "complete" | "partial" | "empty";
  status: PerformanceStatus;
  headline: string;
  /** Who is outstanding, or what else is worth saying. */
  detail: string | null;
  hmRecordsPresent: number;
  activeHmCount: number;
};

export type MonthOverMonthModel = {
  hasPreviousMonth: boolean;
  previousMonthLabel: string | null;
  previousNetLabel: string;
  currentNetLabel: string;
  changeUnitsLabel: string;
  changePercentageLabel: string;
  direction: "up" | "down" | "flat" | "unknown";
  /** Shown instead of the figures when there is nothing to compare against. */
  emptyMessage: string | null;
};

export type QtdModel = {
  quarterLabel: string;
  netLabel: string;
  recruitmentLabel: string;
  isComplete: boolean;
  monthsLabel: string;
  /** "No data yet: July 2026" - never left implicit. */
  incompleteMessage: string | null;
};

/** Why this month is on screen, phrased for the manager reading it. */
export type DashboardNotice = {
  tone: "info" | "warning";
  title: string;
  body: string;
};

export type DashboardMonthModel = {
  id: string;
  label: string;
  /** The `?month=` value. */
  param: string;
  quarterLabel: string;
};

/** One HM in the Management Attention list, and the KPIs that put them there. */
export type ManagementAttentionItemModel = {
  hmId: string;
  name: string;
  /** The Coway identifier - a manager acts on this list, so it names people fully. */
  hmCode: string;
  /** That HM's screen, on the month being looked at. */
  href: string;
  /** "Recruitment", "Net" - the red KPIs only, in the fixed KPI order. */
  kpiLabels: string[];
  /** How many are red. The sort key, and nothing more - it is not a score. */
  attentionCount: number;
};

/**
 * The HMs a manager should look at first.
 *
 * Only NEEDS ATTENTION appears. Watch is a heads-up rather than a problem, and
 * a list holding both would name most of the team most months - which tells
 * nobody anything.
 *
 * There is no advice here, and no explanation beyond the KPI's name: the whole
 * value of the section is that it says nothing the thresholds did not.
 */
export type ManagementAttentionModel = {
  items: ManagementAttentionItemModel[];
  hasItems: boolean;
  /** "3 HMs · 5 KPIs below the attention threshold", or the all-clear. */
  headline: string;
  /** Shown instead of the list when nothing is below the threshold. */
  emptyMessage: string;
};

export type DashboardViewModel = {
  month: DashboardMonthModel;
  /** When the records were last written, or `null` if never. */
  updatedLabel: string | null;
  notice: DashboardNotice | null;
  /** False when the month exists but nobody has keyed anything into it. */
  hasAnyData: boolean;
  kpis: KpiTile[];
  target: TargetProgressModel;
  weekly: WeeklyChartModel;
  hms: HmCardModel[];
  completeness: CompletenessModel;
  monthOverMonth: MonthOverMonthModel;
  qtd: QtdModel;
  /** Who has at least one red KPI. Empty is a good month, and says so. */
  managementAttention: ManagementAttentionModel;
  /**
   * Which Coway week the Key-In bands were taken from, phrased for the header.
   *
   * `null` when the month has no configured weeks. It is stated on screen
   * because "on track" means nothing without "as at W2".
   */
  currentWeekLabel: string | null;
};

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

/**
 * A group total nobody has contributed to reads as blank, not as zero.
 *
 * The engine returns `{ total: 0, contributors: 0 }` for a column no HM has
 * filled in - a true statement about a sum of nothing, and a lie the moment it
 * is printed on a card as "0 units". The contributor count is the engine's own
 * answer to "did anyone enter this", so it is what decides whether the total is
 * worth showing.
 */
function totalLabel(total: number, contributors: number): string {
  return contributors > 0 ? formatUnits(total) : NO_VALUE;
}

/** Bar width for an achievement percentage. See `TargetProgressModel`. */
export function progressWidth(achievementPct: number | null): number | null {
  if (achievementPct === null) {
    return null;
  }

  return Math.max(0, Math.min(100, achievementPct));
}

export function quarterLabel(quarter: number, year: number): string {
  return `Q${quarter} ${year}`;
}

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

/** "units" for a real figure, nothing at all for a blank one. */
function unitFor(value: string): string | null {
  return value === NO_VALUE ? null : "units";
}

function buildKpis(
  group: GroupMonthlyCalculatedPerformance,
  monthParam: string,
): KpiTile[] {
  const { contributors } = group;
  const anyWeekEntered = group.weeklyGroupKeyIn.some((week) => week.isEntered);

  // Derived from the weeks, so "no week has been entered" is what makes it
  // blank - there is no keyed monthly Key-In field that could be missing.
  const keyIn = anyWeekEntered ? formatUnits(group.totalKeyIn) : NO_VALUE;
  const net = totalLabel(group.totalNet, contributors.net);
  const target = totalLabel(group.totalTarget, contributors.target);

  return [
    {
      key: "keyIn",
      label: "Key-In",
      value: keyIn,
      unit: unitFor(keyIn),
      note: anyWeekEntered ? null : "No weeks entered",
    },
    {
      key: "net",
      label: "Net",
      value: net,
      unit: unitFor(net),
      note: contributors.net === 0 ? "Not entered" : null,
    },
    {
      key: "target",
      label: "Target",
      value: target,
      unit: unitFor(target),
      note: contributors.target === 0 ? "Not set" : null,
    },
    {
      key: "achievement",
      label: "Achievement",
      value: formatPercentage(group.groupAchievementPct, { fallback: NO_VALUE }),
      unit: null,
      note:
        group.groupAchievementPct === null ? "Needs a target" : "Net vs target",
    },
    {
      key: "recruitment",
      label: "Recruitment",
      value: totalLabel(group.totalRecruitment, contributors.recruitment),
      unit: null,
      note: "New this month",
    },
    {
      key: "activeHp",
      label: "Active HP",
      value: totalLabel(group.totalActiveHp, contributors.activeHp),
      unit: null,
      // Counted, not keyed: HPs whose Total Key-In for the month is at least 1.
      // Blank rather than 0 when no HP file has been imported, because nobody
      // has said anything about this month's HPs yet.
      note:
        contributors.activeHp === 0
          ? "No HP data imported"
          : "HPs with Key-In this month",
      // Linked only when there is a figure. A link to an empty list is a
      // promise the page cannot keep.
      href:
        contributors.activeHp === 0
          ? null
          : hpListingPath({ month: monthParam, activeOnly: true }),
    },
    {
      key: "netRatio",
      label: "Net ratio",
      value: formatPercentage(group.groupNetRatioPct, { fallback: NO_VALUE }),
      unit: null,
      note: group.groupNetRatioPct === null ? "Needs Key-In" : "Net vs Key-In",
    },
    {
      key: "shi",
      label: "Group SHI",
      // Read straight from `group_monthly_metrics`. Never the average of the HM
      // SHI column, and blank rather than substituted when eTrust has not been
      // keyed in.
      value: formatPercentage(group.groupShiPct, { fallback: NO_VALUE }),
      unit: null,
      note: group.groupShiPct === null ? "Not entered" : "From eTrust",
    },
  ];
}

function buildTarget(
  group: GroupMonthlyCalculatedPerformance,
): TargetProgressModel {
  const hasTarget = group.contributors.target > 0 && group.totalTarget > 0;

  return {
    netLabel: totalLabel(group.totalNet, group.contributors.net),
    targetLabel: totalLabel(group.totalTarget, group.contributors.target),
    achievementLabel: formatPercentage(group.groupAchievementPct, {
      fallback: NO_VALUE,
    }),
    progressPct: hasTarget ? progressWidth(group.groupAchievementPct) : null,
    hasTarget,
  };
}

function buildWeekly(
  group: GroupMonthlyCalculatedPerformance,
): WeeklyChartModel {
  const weeks = group.weeklyGroupKeyIn;

  // The tallest ENTERED week sets the scale. A blank week has no height to
  // give, and letting one into the maximum would silently rescale the chart.
  const tallest = weeks.reduce(
    (max, week) =>
      week.isEntered && week.keyInUnits > max ? week.keyInUnits : max,
    0,
  );

  const weeksEntered = weeks.filter((week) => week.isEntered).length;

  // The group's own monthly target, so the weekly bands are group figure over
  // group target - the same rule the group's Achievement already follows. A
  // month where nobody has set a target has no denominator, so no band.
  const groupTarget: Entry =
    group.contributors.target > 0 && group.totalTarget > 0
      ? group.totalTarget
      : null;

  return {
    weeks: weeks.map((week) => {
      // `null` rather than the 0 for an unentered week: a week nobody has keyed
      // in is blank, and banding a blank as 0% of target would report a
      // catastrophic week for days that have not happened yet.
      const units: Entry = week.isEntered ? week.keyInUnits : null;

      return {
        weekId: week.weekId,
        label: week.weekLabel,
        rangeLabel: formatWeekRange({
          start_date: week.startDate,
          end_date: week.endDate,
        }),
        units,
        unitsLabel: week.isEntered ? formatUnits(week.keyInUnits) : NO_VALUE,
        status: week.status,
        isEntered: week.isEntered,
        barPct:
          week.isEntered && tallest > 0 ? (week.keyInUnits / tallest) * 100 : 0,
        hmsEntered: week.hmsEntered,
        kpiStatus: buildKeyInStatusModel({
          status: getKeyInStatus(week.weekNumber, units, groupTarget),
          weekId: week.weekId,
          weekNumber: week.weekNumber,
          weekLabel: week.weekLabel,
          weekSource: null,
          keyInUnits: units,
          targetUnits: groupTarget,
          achievementPct: keyInAchievement(units, groupTarget),
          hasThreshold: hasKeyInThreshold(week.weekNumber),
          isEntered: week.isEntered,
        }),
      };
    }),
    hasWeeks: weeks.length > 0,
    hasEntries: weeksEntered > 0,
    weeksEntered,
    weeksConfigured: weeks.length,
    totalLabel: weeksEntered > 0 ? formatUnits(group.totalKeyIn) : NO_VALUE,
  };
}

function buildHmCards(
  model: MonthlyPerformanceViewModel,
  month: string,
): HmCardModel[] {
  const statuses = model.hmKpiStatuses;

  // Straight off the Stage 3 ranking - Net descending, with a total tie-break.
  // Nothing here re-sorts: two surfaces disagreeing about who is second is
  // exactly what that ranking exists to prevent.
  return model.rankings.map((entry) => {
    const hm = entry.performance;
    const hasTarget = hm.targetNetUnits !== null && hm.targetNetUnits > 0;

    return {
      rank: entry.rank,
      hmId: hm.hmId,
      hmCode: hm.hmCode,
      href: hmDetailPath(hm.hmId, month),
      name: hm.hmName,
      office: hm.office,
      photoUrl: hm.photoUrl,
      isActive: hm.isActive,
      netLabel: hm.netUnits === null ? NO_VALUE : formatUnits(hm.netUnits),
      keyInLabel:
        hm.presence.weeksEntered > 0 ? formatUnits(hm.totalKeyIn) : NO_VALUE,
      recruitmentLabel:
        hm.recruitment === null ? NO_VALUE : formatUnits(hm.recruitment),
      recruitmentStatus: hm.recruitmentStatus,
      activeHpLabel: hm.activeHp === null ? NO_VALUE : formatUnits(hm.activeHp),
      activeHpHref:
        hm.activeHp === null
          ? null
          : hpListingPath({
              month,
              hmId: hm.hmId,
              activeOnly: true,
            }),
      targetLabel:
        hm.targetNetUnits === null ? NO_VALUE : formatUnits(hm.targetNetUnits),
      achievementLabel: formatPercentage(hm.achievementPct, {
        fallback: NO_VALUE,
      }),
      progressPct: hasTarget ? progressWidth(hm.achievementPct) : null,
      hasTarget,
      hasMonthlyRecord: hm.presence.hasMonthlyRecord,
      // The month model's own statuses, not a second banding of the same
      // figures - this is what makes the card, the HM screen and the attention
      // list incapable of disagreeing.
      statuses: buildHmKpiStatusModels(statuses[hm.hmId]!, hm.netRatioPct),
    };
  });
}

/**
 * The Management Attention list, formatted.
 *
 * The engine decided who is on it and in what order; this names the KPIs and
 * builds the link to each HM's screen on the month being looked at. No advice,
 * no explanation, no ordering of its own.
 */
function buildManagementAttention(
  entries: readonly ManagementAttentionEntry[],
  month: string,
): ManagementAttentionModel {
  const items = entries.map((entry) => ({
    hmId: entry.hmId,
    name: entry.hmName,
    hmCode: entry.hmCode,
    href: hmDetailPath(entry.hmId, month),
    kpiLabels: entry.kpis.map((key) => KPI_LABELS[key]),
    attentionCount: entry.attentionCount,
  }));

  const kpiCount = entries.reduce(
    (total, entry) => total + entry.attentionCount,
    0,
  );

  return {
    items,
    hasItems: items.length > 0,
    headline:
      items.length === 0
        ? "Nothing below the attention threshold"
        : `${items.length} ${items.length === 1 ? "HM" : "HMs"} · ${kpiCount} ${
            kpiCount === 1 ? "KPI" : "KPIs"
          } needing attention`,
    // Said plainly and without congratulation: it is a threshold being met, not
    // a good month, and the two are different claims.
    emptyMessage: "All HM KPIs are above the attention threshold.",
  };
}

function buildCompleteness(
  group: GroupMonthlyCalculatedPerformance,
): CompletenessModel {
  const completeness = group.dataCompleteness;
  const namesById = new Map(group.hms.map((hm) => [hm.hmId, hm.hmName] as const));

  const missingNames = completeness.missingHmIds
    .map((id) => namesById.get(id))
    .filter((name): name is string => Boolean(name));

  const level =
    completeness.activeHmCount === 0 || completeness.hmRecordsPresent === 0
      ? "empty"
      : completeness.isComplete
        ? "complete"
        : "partial";

  const status: PerformanceStatus =
    level === "complete" ? "green" : level === "partial" ? "yellow" : "red";

  const headline =
    completeness.activeHmCount === 0
      ? "No active HMs"
      : completeness.isComplete
        ? `All ${completeness.activeHmCount} HMs updated`
        : `${completeness.hmRecordsPresent} of ${completeness.activeHmCount} HMs updated`;

  const detail =
    missingNames.length > 0
      ? `Nothing entered yet: ${missingNames.join(", ")}`
      : completeness.weeksConfigured === 0
        ? "No sales weeks configured for this month"
        : null;

  return {
    level,
    status,
    headline,
    detail,
    hmRecordsPresent: completeness.hmRecordsPresent,
    activeHmCount: completeness.activeHmCount,
  };
}

/**
 * A month-over-month comparison, formatted.
 *
 * Takes the metric-agnostic engine shape, so the group's Net comparison and an
 * HM's recruitment comparison are presented by the same function - including
 * the two cases a screen would otherwise get wrong on its own: an absent
 * previous month says so instead of showing a change, and a previous month of 0
 * keeps its unit difference but has no percentage.
 */
export function buildMonthOverMonthModel(
  comparison: MetricMonthOverMonth,
): MonthOverMonthModel {
  const previousMonthLabel = comparison.previousMonth
    ? formatMonthLabel(
        comparison.previousMonth.year,
        comparison.previousMonth.month,
      )
    : null;

  const direction: MonthOverMonthModel["direction"] =
    comparison.differenceUnits === null
      ? "unknown"
      : comparison.differenceUnits > 0
        ? "up"
        : comparison.differenceUnits < 0
          ? "down"
          : "flat";

  return {
    hasPreviousMonth: comparison.hasPreviousMonthData,
    previousMonthLabel,
    previousNetLabel:
      comparison.previousValue === null
        ? NO_VALUE
        : formatUnits(comparison.previousValue),
    currentNetLabel: formatUnits(comparison.currentValue),
    changeUnitsLabel: formatSignedUnits(comparison.differenceUnits, {
      fallback: NO_VALUE,
    }),
    // Blank when the previous month was 0 as well as when it is absent: there
    // is no percentage increase from nothing, and "+∞%" is not a figure.
    changePercentageLabel: formatSignedPercentage(comparison.percentageChange, {
      fallback: NO_VALUE,
    }),
    direction,
    emptyMessage: comparison.hasPreviousMonthData
      ? null
      : "No previous month data",
  };
}

export function buildQtdModel(qtd: QtdPerformance): QtdModel {
  const missing = qtd.missingMonths.map((month) =>
    formatMonthLabel(month.year, month.month),
  );

  return {
    quarterLabel: quarterLabel(qtd.quarter, qtd.year),
    netLabel: formatUnits(qtd.netUnits),
    recruitmentLabel: formatUnits(qtd.recruitment),
    isComplete: qtd.isComplete,
    monthsLabel: `${qtd.monthsWithData} of ${qtd.monthsToDate.length} months`,
    incompleteMessage:
      missing.length > 0 ? `No data yet: ${missing.join(", ")}` : null,
  };
}

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

export type DashboardPresenterInput = {
  selectedMonth: Month;
  performance: MonthlyPerformanceViewModel;
  /** Latest `updated_at` across the month's records, or `null`. */
  lastUpdatedAt: string | null;
  notice?: DashboardNotice | null;
};

export function buildDashboardViewModel({
  selectedMonth,
  performance,
  lastUpdatedAt,
  notice = null,
}: DashboardPresenterInput): DashboardViewModel {
  const { group } = performance;
  const param = monthParam(selectedMonth);

  return {
    month: {
      id: selectedMonth.id,
      label: monthLabel(selectedMonth),
      param,
      quarterLabel: quarterLabel(selectedMonth.quarter, selectedMonth.year),
    },
    updatedLabel: formatUpdatedAt(lastUpdatedAt),
    notice,
    hasAnyData: group.hasAnyData,
    kpis: buildKpis(group, param),
    target: buildTarget(group),
    weekly: buildWeekly(group),
    hms: buildHmCards(performance, param),
    completeness: buildCompleteness(group),
    monthOverMonth: buildMonthOverMonthModel(performance.previousMonth),
    qtd: buildQtdModel(performance.qtd),
    managementAttention: buildManagementAttention(
      performance.managementAttention,
      param,
    ),
    currentWeekLabel: performance.currentWeek?.week.weekLabel ?? null,
  };
}
