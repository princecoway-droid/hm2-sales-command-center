import type { HMMonthlyCalculatedPerformance } from "@/lib/calculations/hm";
import type { SalesWeekInput } from "@/lib/calculations/inputs";
import {
  isEntered,
  netRatio,
  percentageOf,
  type Entry,
  type Percentage,
} from "@/lib/calculations/performance";

/**
 * KPI status: who is on track, who needs watching, who needs attention.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is emphatically not
 * ---------------------------------------------------------------------------
 * A PACING INDICATOR. It answers "at this point in the month, is this figure
 * healthy?" against thresholds the business supplied, and nothing else. It does
 * not forecast, does not predict whether a target will eventually be hit, does
 * not score, rank or weight, and there is deliberately no way to combine the
 * four statuses into one - a manager has to see WHICH KPI is off, and an
 * average of four bands hides exactly that.
 *
 * Every threshold in the application lives in the constants below and nowhere
 * else. No component, presenter or page may compare an achievement percentage
 * against a number; they read a status from here.
 *
 * Pure, like the rest of the engine: typed input, typed output, no Supabase, no
 * React, and no clock - the current week is resolved from a date the CALLER
 * supplies, so the same month resolves the same way in a test as on a server.
 *
 * ---------------------------------------------------------------------------
 * `null` is not a fourth band
 * ---------------------------------------------------------------------------
 * A status of `null` means "no status can be stated", and it happens for three
 * honest reasons: the figure has not been keyed in, the denominator it needs is
 * missing, or the business has not defined a threshold for that week (W5/W6).
 * None of them is a bad result, and none of them may be rendered as one. Blank
 * is not zero, in either direction - the rule the rest of this engine is built
 * on holds here too.
 */

// -----------------------------------------------------------------------------
// The status
// -----------------------------------------------------------------------------

export const KPI_STATUSES = [
  "needs_attention",
  "watch",
  "on_track",
] as const;

/**
 * The three bands. Exactly three, by business decision.
 *
 * The value is the machine-readable key; the words a manager reads are mapped
 * in the presentation layer, so no string literal like "On Track" is ever
 * compared against in logic.
 */
export type KpiStatus = (typeof KPI_STATUSES)[number];

/** True for the one band that belongs in Management Attention. */
export function needsAttention(status: KpiStatus | null): boolean {
  return status === "needs_attention";
}

// -----------------------------------------------------------------------------
// Thresholds
// -----------------------------------------------------------------------------

/**
 * One week's Key-In bands, as a share of the HM's MONTHLY target.
 *
 * `edge` is not decoration. The business stated W1 with strict comparisons -
 * "15% or below is Needs Attention, above 25% is On Track", so 25% itself is
 * Watch - and W2 to W4 with inclusive ones - "30% or more is Watch, 50% or more
 * is On Track". Writing the comparator down beside the numbers is what stops
 * the two shapes being quietly flattened into one the next time somebody adds
 * a week.
 */
export type KeyInWeekThreshold = {
  weekNumber: number;
  /** The edge of WATCH: reaching it leaves Needs Attention. */
  watch: number;
  /** The edge of ON TRACK. */
  onTrack: number;
  /** `inclusive` compares with `>=`; `exclusive` with `>`. */
  edge: "inclusive" | "exclusive";
};

/**
 * The Key-In bands, week by week, exactly as the business supplied them.
 *
 *   W1   <=15 attention   >15 and <=25 watch    >25 on track
 *   W2   <30  attention   >=30 and <50 watch    >=50 on track
 *   W3   <45  attention   >=45 and <75 watch    >=75 on track
 *   W4   <60  attention   >=60 and <100 watch   >=100 on track
 *
 * W5 and W6 are ABSENT on purpose. The application supports four to six Coway
 * weeks and the business has not defined bands for the last two, so a month
 * that has them reports no Key-In status for those weeks rather than an
 * invented one. See `hasKeyInThreshold`.
 */
export const KEYIN_WEEK_THRESHOLDS: readonly KeyInWeekThreshold[] = [
  { weekNumber: 1, watch: 15, onTrack: 25, edge: "exclusive" },
  { weekNumber: 2, watch: 30, onTrack: 50, edge: "inclusive" },
  { weekNumber: 3, watch: 45, onTrack: 75, edge: "inclusive" },
  { weekNumber: 4, watch: 60, onTrack: 100, edge: "inclusive" },
] as const;

/** Recruitment for the month: 0-2 attention, 3-4 watch, >=5 on track. */
export const RECRUITMENT_THRESHOLD = { watch: 3, onTrack: 5 } as const;

/** Net Ratio: <50 attention, 50 to under 75 watch, >=75 on track. */
export const NET_RATIO_THRESHOLD = { watch: 50, onTrack: 75 } as const;

/**
 * Active HP: <10 attention, 10-20 watch, >20 on track.
 *
 * The On Track edge is EXCLUSIVE - 20 is Watch, 21 is On Track - which is the
 * one place these bands do not read the same way as the others.
 */
export const ACTIVE_HP_THRESHOLD = { watch: 10, onTrack: 20 } as const;

/** Is a Key-In band defined for this week number at all? W5/W6: no. */
export function hasKeyInThreshold(weekNumber: number): boolean {
  return KEYIN_WEEK_THRESHOLDS.some(
    (threshold) => threshold.weekNumber === weekNumber,
  );
}

export function keyInThresholdFor(
  weekNumber: number,
): KeyInWeekThreshold | null {
  return (
    KEYIN_WEEK_THRESHOLDS.find(
      (threshold) => threshold.weekNumber === weekNumber,
    ) ?? null
  );
}

// -----------------------------------------------------------------------------
// Banding
// -----------------------------------------------------------------------------

type Edge = "inclusive" | "exclusive";

/**
 * The one comparison in the file.
 *
 * Every band below is expressed through it, so "is 50% Watch or On Track" has
 * a single answer whichever KPI is asking.
 *
 * The two edges are separate arguments because one KPI genuinely needs them to
 * differ: Active HP is stated as ">=10 Watch, >20 On Track", so 10 is amber and
 * 20 is still amber. A single shared comparator would have to get one of those
 * two wrong.
 */
function band(
  value: number,
  watch: number,
  onTrack: number,
  watchEdge: Edge = "inclusive",
  onTrackEdge: Edge = watchEdge,
): KpiStatus {
  const reached = (limit: number, edge: Edge) =>
    edge === "inclusive" ? value >= limit : value > limit;

  if (reached(onTrack, onTrackEdge)) {
    return "on_track";
  }

  return reached(watch, watchEdge) ? "watch" : "needs_attention";
}

// -----------------------------------------------------------------------------
// Key-In
// -----------------------------------------------------------------------------

/**
 * Key-In achievement at a point in the month:
 * `Key-In SO FAR / MONTHLY target x 100`.
 *
 * ---------------------------------------------------------------------------
 * The numerator is CUMULATIVE
 * ---------------------------------------------------------------------------
 * `keyInToDate` is the running total of the weeks up to and including the one
 * being banded - W1 at W1, W1+W2 at W2, W1+W2+W3 at W3 - not that week's own
 * figure.
 *
 * The thresholds say so themselves. On Track at W4 is 100% of the MONTHLY
 * target: no HM sells a whole month's target inside week four, so a band that
 * could only be reached by doing exactly that would be unreachable by
 * construction. Read cumulatively, 15/25 - 30/50 - 45/75 - 60/100 is what it
 * plainly is: a pace curve, roughly a quarter of the target per week, with a
 * widening allowance for a slow start.
 *
 * The denominator is the HM's monthly target, never a weekly one - the business
 * does not set weekly targets, and inventing "target / 4" would put a figure
 * nobody agreed on at the centre of every status on the dashboard.
 *
 * `null` when either side is missing or the target is 0, exactly like
 * `targetAchievement`: an HM with no target has an UNKNOWN pace, not a 0% one.
 */
export function keyInAchievement(
  keyInToDate: Entry,
  monthlyTarget: Entry,
): Percentage {
  if (!isEntered(keyInToDate) || !isEntered(monthlyTarget)) {
    return null;
  }

  return percentageOf(keyInToDate, monthlyTarget);
}

/**
 * The Key-In band at the end of a given week.
 *
 * `keyInToDate` is the CUMULATIVE Key-In through that week - see
 * `keyInAchievement`. Passing one week's own figure here is the mistake this
 * parameter is named to prevent.
 *
 * `null` in three cases, all of them "no status can be stated" rather than a
 * bad one:
 *
 *   the week has no defined threshold      W5 or W6
 *   the week has not been keyed in         a blank week is not a zero week
 *   there is no target to measure against  blank, or an entered 0
 */
export function getKeyInStatus(
  weekNumber: number,
  keyInToDate: Entry,
  monthlyTarget: Entry,
): KpiStatus | null {
  const threshold = keyInThresholdFor(weekNumber);

  if (!threshold) {
    return null;
  }

  const achievement = keyInAchievement(keyInToDate, monthlyTarget);

  if (achievement === null) {
    return null;
  }

  return band(achievement, threshold.watch, threshold.onTrack, threshold.edge);
}

/**
 * The running Key-In total through each week, in week order.
 *
 * Blanks contribute nothing rather than counting as zero - the rule the rest of
 * this engine is built on - so a month with W2 missing carries W1's total into
 * W3 rather than resetting or inventing a figure. `blankBefore` travels with
 * each entry because that is exactly when the running total UNDERSTATES the
 * month, and a red caused by a week nobody keyed in is not a red about the HM.
 *
 * A week that is itself blank gets `toDate: null`: there is no point in the
 * month to band, because that point has not been recorded.
 */
export function cumulativeKeyIn(
  weeks: readonly { weekNumber: number; keyInUnits: Entry }[],
): { weekNumber: number; toDate: Entry; blankBefore: number }[] {
  const ordered = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);

  let running = 0;
  let entered = false;
  let blankBefore = 0;

  return ordered.map((week) => {
    const blanksSoFar = blankBefore;

    if (isEntered(week.keyInUnits)) {
      running += week.keyInUnits;
      entered = true;
    } else {
      blankBefore += 1;
    }

    return {
      weekNumber: week.weekNumber,
      // `entered` rather than `running > 0`: an HM whose only entered week is a
      // real zero has a running total of 0, which is a figure, not a blank.
      toDate: isEntered(week.keyInUnits) && entered ? running : null,
      blankBefore: blanksSoFar,
    };
  });
}

// -----------------------------------------------------------------------------
// Recruitment
// -----------------------------------------------------------------------------

/**
 * Recruitment for the month: 0-2 attention, 3-4 watch, >=5 on track.
 *
 * An entered 0 is a real Needs Attention. A blank is `null` - nobody has said
 * anything about this HM's recruitment yet, and reporting them as failing would
 * be reporting the PA's inbox rather than the HM's month.
 */
export function getRecruitmentStatus(recruitment: Entry): KpiStatus | null {
  if (!isEntered(recruitment)) {
    return null;
  }

  return band(
    recruitment,
    RECRUITMENT_THRESHOLD.watch,
    RECRUITMENT_THRESHOLD.onTrack,
  );
}

// -----------------------------------------------------------------------------
// Net
// -----------------------------------------------------------------------------

/**
 * The Net band, off the HM's OWN Net Ratio: `total Net / total Key-In x 100`.
 *
 * Never the group ratio, and never the mean of the HP-level ratios - both are
 * different numbers, and neither describes this HM.
 *
 * The zero-Key-In case is the business's own instruction: an HM with Net
 * entered and nothing keyed in has an undefined ratio, and it is reported as
 * NEEDS ATTENTION rather than given an invented 0%. The ratio itself still
 * comes back `null` from the engine, so the screen shows "—" beside the band
 * rather than a number that does not exist.
 *
 * Net not entered at all is `null` - no figure, no judgement.
 */
export function getNetStatus(
  totalNet: Entry,
  totalKeyIn: number,
): KpiStatus | null {
  if (!isEntered(totalNet)) {
    return null;
  }

  if (!Number.isFinite(totalKeyIn) || totalKeyIn <= 0) {
    return "needs_attention";
  }

  const ratio = netRatio(totalNet, totalKeyIn);

  if (ratio === null) {
    return "needs_attention";
  }

  return band(ratio, NET_RATIO_THRESHOLD.watch, NET_RATIO_THRESHOLD.onTrack);
}

// -----------------------------------------------------------------------------
// Active HP
// -----------------------------------------------------------------------------

/**
 * Active HP: <10 attention, 10-20 watch, >20 on track.
 *
 * The figure is the Stage 8 HP-DERIVED count - HPs of this HM whose Total
 * Key-In for the month is at least 1 - and never the deprecated
 * `hm_monthly_performance.active_hp` column, which this engine does not read at
 * all. A `null` here is "no HP file has been imported for this HM and month",
 * which is not the same as nobody being active.
 */
export function getActiveHpStatus(activeHp: Entry): KpiStatus | null {
  if (!isEntered(activeHp)) {
    return null;
  }

  return band(
    activeHp,
    ACTIVE_HP_THRESHOLD.watch,
    ACTIVE_HP_THRESHOLD.onTrack,
    // 10 IS Watch - the lower edge is inclusive, like every other KPI.
    "inclusive",
    // 20 is Watch and 21 is On Track: the upper edge is the business's one
    // exclusive comparison outside W1, and the reason `band` takes two.
    "exclusive",
  );
}

// -----------------------------------------------------------------------------
// Which week the month is at
// -----------------------------------------------------------------------------

/**
 * Why a week is the one the Key-In status is taken from.
 *
 *   in_progress       today falls inside the week's Coway period
 *   latest_completed  today is past it, and it is the most recent that ended -
 *                     the answer for every historical month, and for the gap
 *                     between two periods
 *   not_started       today is before the month's first period, so W1 stands in
 */
export type CurrentWeekSource =
  | "in_progress"
  | "latest_completed"
  | "not_started";

export type CurrentWeekResolution = {
  week: SalesWeekInput;
  source: CurrentWeekSource;
};

/**
 * The month's current Coway week, resolved from the CONFIGURED periods.
 *
 * `sales_weeks` is the source of truth and the only one: a Coway week is not a
 * calendar week, W1 routinely starts in the previous calendar month, and a
 * month has anywhere from four to six of them. Nothing here divides the month
 * into sevenths or assumes a count.
 *
 * `today` is an ISO `YYYY-MM-DD` in the REPORTING timezone, supplied by the
 * caller - the engine has no clock, and comparing an ISO date to two ISO dates
 * is a string comparison with no timezone in it to get wrong.
 *
 * A historical month has no week "in progress", so it resolves to the last one
 * that ended, which is what makes August's status August's rather than today's.
 */
export function resolveCurrentWeek(
  weeks: readonly SalesWeekInput[],
  today: string,
): CurrentWeekResolution | null {
  if (weeks.length === 0) {
    return null;
  }

  const ordered = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);

  const inProgress = ordered.find(
    (week) => week.startDate <= today && today <= week.endDate,
  );

  if (inProgress) {
    return { week: inProgress, source: "in_progress" };
  }

  // The most recently ENDED period. Covers both a historical month and the gap
  // a Coway calendar can leave between two periods.
  const completed = ordered.filter((week) => week.endDate < today);

  if (completed.length > 0) {
    const latest = completed.reduce((best, week) =>
      week.endDate > best.endDate ? week : best,
    );

    return { week: latest, source: "latest_completed" };
  }

  // The whole month is still ahead: a month opened early. W1 stands in, and
  // says so - it has no figures, so its status is `null` anyway.
  return { week: ordered[0]!, source: "not_started" };
}

// -----------------------------------------------------------------------------
// One HM's four statuses
// -----------------------------------------------------------------------------

/**
 * The Key-In status, with the arithmetic that produced it.
 *
 * The basis travels with the band because the status is only useful if the
 * manager can see what it was measured against - "W2, 27 of 100, 27%" is a
 * statement they can check, where a lone amber dot is one they have to trust.
 */
export type KeyInKpiStatus = {
  status: KpiStatus | null;
  /** The week the status is for, or `null` when the month has no weeks. */
  weekId: string | null;
  weekNumber: number | null;
  /** "W2", from the sales calendar - never derived from the dates. */
  weekLabel: string | null;
  /** Why this week: in progress, the last that ended, or the month not started. */
  weekSource: CurrentWeekSource | null;
  /** That week's own Key-In. Shown; NOT what the band is measured on. */
  keyInUnits: Entry;
  /**
   * The CUMULATIVE Key-In through that week - W1+W2 at W2 - which is what the
   * band is measured on. See `keyInAchievement`.
   */
  keyInToDate: Entry;
  /** The HM's MONTHLY target - the denominator, and never a weekly figure. */
  targetUnits: Entry;
  /** `keyInToDate / targetUnits x 100`, or `null`. */
  achievementPct: Percentage;
  /**
   * Earlier weeks with no figure, which the running total is therefore missing.
   *
   * Carried so a screen can say the pace is measured on incomplete data. A red
   * caused by an unkeyed W1 is a gap in the records, not a verdict on the HM.
   */
  blankBefore: number;
  /** False for W5/W6, where the business has defined no band. */
  hasThreshold: boolean;
  /** True once the week carries a figure. A blank week is not a zero week. */
  isEntered: boolean;
};

/** One week of the month, banded against the HM's monthly target. */
export type WeeklyKeyInKpiStatus = {
  weekId: string;
  weekNumber: number;
  weekLabel: string;
  status: KpiStatus | null;
  /** That week's own Key-In. Shown; NOT what the band is measured on. */
  keyInUnits: Entry;
  /** The CUMULATIVE Key-In through this week, which the band IS measured on. */
  keyInToDate: Entry;
  achievementPct: Percentage;
  hasThreshold: boolean;
  isEntered: boolean;
  /** Earlier weeks with no figure. See `KeyInKpiStatus.blankBefore`. */
  blankBefore: number;
  /** True for the week `resolveCurrentWeek` picked out. */
  isCurrent: boolean;
};

/**
 * The four statuses for one HM, kept SEPARATE.
 *
 * There is no fifth field here and there is not going to be one. An overall
 * score - an average, a weighted total, a points system - would answer "how is
 * this HM doing" with a number that cannot be acted on, when the question a
 * manager actually has is "which of the four do I raise with them".
 */
export type HmKpiStatuses = {
  hmId: string;
  hmName: string;
  hmCode: string;
  keyIn: KeyInKpiStatus;
  net: KpiStatus | null;
  recruitment: KpiStatus | null;
  activeHp: KpiStatus | null;
  /** Every week of the month banded, for the weekly section. In week order. */
  weekly: WeeklyKeyInKpiStatus[];
};

/** The four KPIs, in the order every surface shows them. */
export const HM_KPI_KEYS = ["keyIn", "net", "recruitment", "activeHp"] as const;

export type HmKpiKey = (typeof HM_KPI_KEYS)[number];

/** The status of each KPI, by key - for counting reds without four `if`s. */
export function kpiStatusMap(
  statuses: HmKpiStatuses,
): Record<HmKpiKey, KpiStatus | null> {
  return {
    keyIn: statuses.keyIn.status,
    net: statuses.net,
    recruitment: statuses.recruitment,
    activeHp: statuses.activeHp,
  };
}

/**
 * Every KPI status for one HM and month.
 *
 * Reads the ALREADY CALCULATED model - it does not re-derive Key-In, Net Ratio
 * or Active HP, it bands them - so a status can never disagree with the figure
 * printed beside it.
 *
 * `currentWeek` is passed in rather than resolved here so that one resolution
 * serves every HM in the month: the current week is a property of the calendar,
 * not of the person.
 */
export function getHmKpiStatuses(
  hm: HMMonthlyCalculatedPerformance,
  currentWeek: CurrentWeekResolution | null,
): HmKpiStatuses {
  const target = hm.targetNetUnits;

  // The running total, once, in week order - so every week is banded on the
  // month SO FAR rather than on its own figure.
  const toDate = new Map(
    cumulativeKeyIn(hm.weeklyPerformance).map(
      (entry) => [entry.weekNumber, entry] as const,
    ),
  );

  const weekly: WeeklyKeyInKpiStatus[] = hm.weeklyPerformance.map((week) => {
    const running = toDate.get(week.weekNumber);
    const keyInToDate = running?.toDate ?? null;

    return {
      weekId: week.weekId,
      weekNumber: week.weekNumber,
      weekLabel: week.weekLabel,
      status: getKeyInStatus(week.weekNumber, keyInToDate, target),
      keyInUnits: week.keyInUnits,
      keyInToDate,
      achievementPct: keyInAchievement(keyInToDate, target),
      hasThreshold: hasKeyInThreshold(week.weekNumber),
      isEntered: week.isEntered,
      blankBefore: running?.blankBefore ?? 0,
      isCurrent: currentWeek?.week.weekId === week.weekId,
    };
  });

  const current = currentWeek
    ? (weekly.find((week) => week.weekId === currentWeek.week.weekId) ?? null)
    : null;

  return {
    hmId: hm.hmId,
    hmName: hm.hmName,
    hmCode: hm.hmCode,

    keyIn: {
      status: current?.status ?? null,
      weekId: current?.weekId ?? null,
      weekNumber: current?.weekNumber ?? null,
      weekLabel: current?.weekLabel ?? null,
      weekSource: currentWeek?.source ?? null,
      keyInUnits: current?.keyInUnits ?? null,
      keyInToDate: current?.keyInToDate ?? null,
      targetUnits: target,
      achievementPct: current?.achievementPct ?? null,
      hasThreshold: current?.hasThreshold ?? false,
      isEntered: current?.isEntered ?? false,
      blankBefore: current?.blankBefore ?? 0,
    },

    // Off this HM's own totals. `totalKeyIn` is the engine's sum of the entered
    // weeks - there is no stored monthly Key-In to disagree with it.
    net: getNetStatus(hm.netUnits, hm.totalKeyIn),
    recruitment: getRecruitmentStatus(hm.recruitment),
    activeHp: getActiveHpStatus(hm.activeHp),

    weekly,
  };
}

/** Every HM of the month, in the order they were given. */
export function getHmKpiStatusesForMonth(
  hms: readonly HMMonthlyCalculatedPerformance[],
  currentWeek: CurrentWeekResolution | null,
): HmKpiStatuses[] {
  return hms.map((hm) => getHmKpiStatuses(hm, currentWeek));
}

// -----------------------------------------------------------------------------
// Management attention
// -----------------------------------------------------------------------------

/** One HM with at least one red KPI, and which ones. */
export type ManagementAttentionEntry = {
  hmId: string;
  hmName: string;
  hmCode: string;
  /** The KPIs at NEEDS ATTENTION, in the fixed KPI order. Never empty. */
  kpis: HmKpiKey[];
  /** `kpis.length`. The sort key, and nothing else - it is not a score. */
  attentionCount: number;
};

/**
 * The HMs a manager has to look at, and why.
 *
 * ONLY `needs_attention` qualifies. Watch is a heads-up, not a problem, and a
 * list that mixed the two would be a list of everybody - which is a list of
 * nobody.
 *
 * Order: most red KPIs first, then the order the HMs arrived in - the
 * dashboard's own ranking. `sort` is stable in every runtime this application
 * targets, so equal counts keep that order rather than being reshuffled on
 * each render.
 *
 * There is no score here. `attentionCount` is a count of red KPIs used to sort,
 * not a rating of the HM: three reds is more to talk about than one, and that
 * is the whole of what it says.
 */
export function getManagementAttention(
  statuses: readonly HmKpiStatuses[],
): ManagementAttentionEntry[] {
  const entries: ManagementAttentionEntry[] = [];

  for (const hm of statuses) {
    const map = kpiStatusMap(hm);
    const kpis = HM_KPI_KEYS.filter((key) => needsAttention(map[key]));

    if (kpis.length === 0) {
      continue;
    }

    entries.push({
      hmId: hm.hmId,
      hmName: hm.hmName,
      hmCode: hm.hmCode,
      kpis: [...kpis],
      attentionCount: kpis.length,
    });
  }

  return entries.sort((a, b) => b.attentionCount - a.attentionCount);
}
