/**
 * Performance calculations.
 *
 * The primitives of the KPI engine: one figure in, one figure out. Everything
 * larger - the HM model, the group aggregate, QTD, MoM, ranking - is assembled
 * from these in the sibling modules and re-exported from `./index`, so there is
 * exactly one definition of each rule and nothing in a component, a chart or a
 * report may recompute a figure that already has a function here.
 *
 * Two rules the whole application depends on:
 *
 *   Monthly Key-In is NEVER a stored field. It is `sumKeyIn(weekly values)`.
 *   Group SHI is NEVER derived. It is keyed in from eTrust and only ever read.
 *
 * All figures are UNITS, never currency.
 */

// -----------------------------------------------------------------------------
// Blank vs zero
// -----------------------------------------------------------------------------

/**
 * A cell the PA may not have filled in yet.
 *
 * `null` means "not entered"; `0` means "entered, and the value really is zero".
 * The distinction drives both the status colours and the completeness summary,
 * so nothing here may quietly coerce one into the other.
 */
export type Entry = number | null;

export function isEntered(value: Entry): value is number {
  return value !== null;
}

/**
 * A ratio expressed as a percentage, or `null` when one cannot be calculated.
 *
 * `null` is the only "unavailable" value in this codebase. There is no magic
 * number, no `-1`, and never a `NaN` or an `Infinity`: a metric whose
 * denominator is zero or whose inputs were never entered is *unknown*, and the
 * type says so, so a caller has to decide what to show rather than accidentally
 * rendering "Infinity%" or ranking an HM by a sentinel.
 */
export type Percentage = number | null;

// -----------------------------------------------------------------------------
// Weekly Key-In
// -----------------------------------------------------------------------------

/**
 * Monthly Key-In: the sum of the weeks that have been entered.
 *
 * Blank weeks contribute nothing rather than counting as zero, which is what
 * makes a part-entered month read as a running total instead of a shortfall.
 */
export function sumKeyIn(values: readonly Entry[]): number {
  return values.reduce<number>(
    (total, value) => (isEntered(value) ? total + value : total),
    0,
  );
}

/** True once at least one week has a figure. */
export function hasAnyKeyIn(values: readonly Entry[]): boolean {
  return values.some(isEntered);
}

/** Weeks still blank - what the completeness indicator counts as outstanding. */
export function countBlankWeeks(values: readonly Entry[]): number {
  return values.filter((value) => !isEntered(value)).length;
}

// -----------------------------------------------------------------------------
// Status bands
// -----------------------------------------------------------------------------

/**
 * `neutral` is not a fourth performance band - it means "no figure yet".
 * A blank week is not a bad week, and colouring it red would tell the manager
 * an HM underperformed when nobody has keyed the number in.
 */
export type PerformanceStatus = "green" | "yellow" | "red" | "neutral";

/** Weekly Key-In: >15 green, 10-15 yellow, <10 red. 15 is yellow, 16 is green. */
export const WEEKLY_KEYIN_GREEN_ABOVE = 15;
export const WEEKLY_KEYIN_YELLOW_FROM = 10;

export function weeklyKeyInStatus(value: Entry): PerformanceStatus {
  if (!isEntered(value)) {
    return "neutral";
  }

  if (value > WEEKLY_KEYIN_GREEN_ABOVE) {
    return "green";
  }

  if (value >= WEEKLY_KEYIN_YELLOW_FROM) {
    return "yellow";
  }

  return "red";
}

/** Recruitment: >=3 green, 1-2 yellow, 0 red. 3 is green, 2 is yellow. */
export const RECRUITMENT_GREEN_FROM = 3;

export function recruitmentStatus(value: Entry): PerformanceStatus {
  if (!isEntered(value)) {
    return "neutral";
  }

  if (value >= RECRUITMENT_GREEN_FROM) {
    return "green";
  }

  return value > 0 ? "yellow" : "red";
}

// -----------------------------------------------------------------------------
// Ratios
// -----------------------------------------------------------------------------

/**
 * A percentage, or `null` when the denominator makes one meaningless.
 *
 * Returning null rather than 0 matters: an HM with no target has an *unknown*
 * achievement, not a 0% one, and the difference shows up the moment a figure
 * is averaged or ranked.
 */
export function percentageOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }

  return (part / whole) * 100;
}

/** Extrade share of Net. */
export function extradePercentage(extrade: Entry, net: Entry): number | null {
  if (!isEntered(extrade) || !isEntered(net)) {
    return null;
  }

  return percentageOf(extrade, net);
}

/** Non-Extrade share of Net. */
export function nonExtradePercentage(
  nonExtrade: Entry,
  net: Entry,
): number | null {
  if (!isEntered(nonExtrade) || !isEntered(net)) {
    return null;
  }

  return percentageOf(nonExtrade, net);
}

/** Net against the HM's own target for the month. */
export function targetAchievement(net: Entry, target: Entry): number | null {
  if (!isEntered(net) || !isEntered(target)) {
    return null;
  }

  return percentageOf(net, target);
}

/**
 * Net Ratio: how much of what was keyed in became a net sale.
 *
 * The denominator is the *derived* Key-In total, so it is a plain number rather
 * than an `Entry` - a month with no weeks entered sums to 0, which is a real
 * zero denominator and therefore an unknown ratio, not a 0% one.
 *
 * Never average per-HM net ratios to get a group figure: a group's ratio is its
 * own total Net over its own total Key-In, which is not the mean of the parts.
 */
export function netRatio(net: Entry, totalKeyIn: number): Percentage {
  if (!isEntered(net)) {
    return null;
  }

  return percentageOf(net, totalKeyIn);
}

// -----------------------------------------------------------------------------
// The Extrade identity
// -----------------------------------------------------------------------------

/**
 * How far the split is from Net: `net - extrade - nonExtrade`.
 *
 * Positive means units are still unallocated, negative means the split
 * over-counts. `null` while any of the three is blank, because "off by 40" is a
 * misleading thing to show someone who has simply not typed the split yet.
 */
export function extradeRemainder(
  net: Entry,
  extrade: Entry,
  nonExtrade: Entry,
): number | null {
  if (!isEntered(net) || !isEntered(extrade) || !isEntered(nonExtrade)) {
    return null;
  }

  return net - extrade - nonExtrade;
}

/**
 * The signed split balance: `extrade + nonExtrade - net`.
 *
 * Sign convention, which is what makes this worth a second function:
 *
 *   0         balanced - the split accounts for exactly the Net units
 *   positive  excess split units - the two halves over-count Net
 *   negative  missing split units - Net is not fully allocated yet
 *
 * This is the exact negation of `extradeRemainder`, which answers the
 * data-entry question ("how many units are left to allocate?") and is what the
 * grid's Balance column has always shown. Both are kept, deliberately: changing
 * the sign of the one the grid uses would silently flip a colour and an arrow
 * on a screen that already works. Reporting surfaces take this one.
 */
export function splitBalance(
  net: Entry,
  extrade: Entry,
  nonExtrade: Entry,
): number | null {
  const remainder = extradeRemainder(net, extrade, nonExtrade);

  return remainder === null ? null : -remainder;
}

export type SplitPercentages = {
  extradePct: Percentage;
  nonExtradePct: Percentage;
  /** `extrade + nonExtrade - net`. 0 is balanced. See `splitBalance`. */
  balance: number | null;
};

/**
 * The Extrade mix in one call, so no caller has to remember that all three
 * figures come off the same denominator.
 *
 * With Net at 0 both percentages are `null` rather than 0%: a share of nothing
 * is undefined, and showing "0.0% Extrade" for a month nobody has sold in reads
 * as a real, bad number. A UI that wants a zero-state can check
 * `extradeUnits === 0 && nonExtradeUnits === 0` itself - that is a presentation
 * decision, and it is not this function's to make.
 */
export function calculateSplitPercentages(
  net: Entry,
  extrade: Entry,
  nonExtrade: Entry,
): SplitPercentages {
  return {
    extradePct: extradePercentage(extrade, net),
    nonExtradePct: nonExtradePercentage(nonExtrade, net),
    balance: splitBalance(net, extrade, nonExtrade),
  };
}

/**
 * Whether the row may be written to `hm_monthly_performance`.
 *
 * Mirrors the database CHECK exactly, with the blank cases spelled out. A blank
 * numeric saves as 0, so that is what the rule is applied to:
 *
 *   Net > 0   Extrade + Non-Extrade must equal Net.
 *   Net = 0   both must be 0, or blank.
 */
export function isSaveableSplit(
  net: Entry,
  extrade: Entry,
  nonExtrade: Entry,
): boolean {
  const netValue = isEntered(net) ? net : 0;
  const extradeValue = isEntered(extrade) ? extrade : 0;
  const nonExtradeValue = isEntered(nonExtrade) ? nonExtrade : 0;

  return extradeValue + nonExtradeValue === netValue;
}

// -----------------------------------------------------------------------------
// Data completeness
// -----------------------------------------------------------------------------

/**
 * The monthly figures that count as "the PA has been here".
 *
 * Target alone deliberately counts: targets are usually set at the start of the
 * month, before any sales exist, and a month where every target is in place is
 * further along than one where nothing has been touched.
 */
export type CompletenessRow = {
  hmId: string;
  net_units: Entry;
  target_net_units: Entry;
  recruitment: Entry;
  active_hp: Entry;
  shi_percentage: Entry;
  extrade_units: Entry;
  non_extrade_units: Entry;
  weekly: readonly Entry[];
};

/** True when anything at all has been recorded for this HM this month. */
export function hasRecordedData(row: CompletenessRow): boolean {
  if (hasAnyKeyIn(row.weekly)) {
    return true;
  }

  return [
    row.net_units,
    row.target_net_units,
    row.recruitment,
    row.active_hp,
    row.shi_percentage,
    row.extrade_units,
    row.non_extrade_units,
  ].some((value) => isEntered(value) && value > 0);
}

export type CompletenessLevel = "empty" | "partial" | "complete";

export type CompletenessSummary = {
  /** Active HMs shown in the grid. */
  total: number;
  /** Active HMs with at least one figure recorded. */
  withData: number;
  /** Active HMs with nothing recorded yet. */
  missingHmIds: string[];
  level: CompletenessLevel;
};

/**
 * Counts, not a score.
 *
 * The one job here is to stop a manager reading a half-entered month as a
 * finished one, so it says how many HMs have figures and names the ones that do
 * not. Anything cleverer would be a judgement the data cannot support - an HM
 * can legitimately have a zero week.
 */
export function summariseCompleteness(
  rows: readonly CompletenessRow[],
): CompletenessSummary {
  const missingHmIds = rows
    .filter((row) => !hasRecordedData(row))
    .map((row) => row.hmId);

  const total = rows.length;
  const withData = total - missingHmIds.length;

  const level: CompletenessLevel =
    total === 0 || withData === 0
      ? "empty"
      : withData === total
        ? "complete"
        : "partial";

  return { total, withData, missingHmIds, level };
}

// -----------------------------------------------------------------------------
// Display
// -----------------------------------------------------------------------------

/** `72.5` -> "72.5%". `null` -> the placeholder. */
export function formatPercentage(
  value: number | null,
  { digits = 1, fallback = "—" }: { digits?: number; fallback?: string } = {},
): string {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }

  return `${value.toFixed(digits)}%`;
}

/** Blank cells render as an em dash, never as 0. */
export function formatEntry(value: Entry, fallback = "—"): string {
  return isEntered(value) ? String(value) : fallback;
}

/**
 * A unit count, grouped: `1245` -> "1,245". `null` -> the placeholder.
 *
 * Fixed to `en-GB` rather than the viewer's locale on purpose. The figure is
 * rendered on the server and hydrated on the client, and a separator that
 * changes between the two is a hydration mismatch; a comma is also what the
 * Coway reports these numbers are reconciled against use.
 */
export function formatUnits(
  value: number | null,
  { fallback = "—" }: { fallback?: string } = {},
): string {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }

  return new Intl.NumberFormat("en-GB").format(value);
}

/** `+41` / `-12` / `0`. The sign is the point, so it is always shown. */
export function formatSignedUnits(
  value: number | null,
  { fallback = "—" }: { fallback?: string } = {},
): string {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }

  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatUnits(Math.abs(value))}`;
}

/** `+10.5%` / `−3.2%`. `null` -> the placeholder, never "0%" or "∞%". */
export function formatSignedPercentage(
  value: number | null,
  { digits = 1, fallback = "—" }: { digits?: number; fallback?: string } = {},
): string {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }

  const sign = value > 0 ? "+" : value < 0 ? "−" : "";

  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}
