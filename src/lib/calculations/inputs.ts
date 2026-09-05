import type { Entry } from "@/lib/calculations/performance";
import type {
  HM,
  HMMonthlyPerformance,
  HMWeeklyPerformance,
  Month,
  SalesWeek,
} from "@/types/models";

/**
 * Normalization: raw database rows in, calculation inputs out.
 *
 * The engine downstream of this file never sees a `Tables<...>` row. That is
 * what makes it testable without a database and what keeps a column rename from
 * reaching the ranking code, but the bigger reason is semantic:
 *
 * ---------------------------------------------------------------------------
 * Absent row vs zero column
 * ---------------------------------------------------------------------------
 * Every numeric column on `hm_monthly_performance` and `hm_weekly_performance`
 * is NOT NULL with a default of 0. A saved row therefore has no way to say "the
 * PA has not filled this in" - the only place that information survives is the
 * *existence of the row*.
 *
 * So the mapping is:
 *
 *   no monthly row for (hm, month)   -> every monthly figure is `null`
 *   a monthly row exists             -> every figure is the number it holds,
 *                                       and a 0 there is a real, entered zero
 *   no weekly row for (hm, week)     -> that week Key-In is `null`, blank
 *   a weekly row exists              -> its Key-In, and 0 means a zero week
 *
 * Nothing below this line may re-introduce a 0 for a missing row; that is the
 * single conversion that would turn "September has not been keyed in" into
 * "September was a total failure".
 * ---------------------------------------------------------------------------
 */

// -----------------------------------------------------------------------------
// What a "record" has to carry
// -----------------------------------------------------------------------------

/**
 * The performance columns the engine actually reads.
 *
 * Narrower than the database row on purpose. The engine never wanted the row's
 * id or its audit columns, and saying so in the type is what lets a caller hand
 * over a projection rather than a row - which is exactly what the public share
 * route does: `resolve_share_report` returns the figures WITHOUT `created_by`
 * and `updated_by`, and it still satisfies this contract, so the shared report
 * runs through the same engine as the private dashboard without a second code
 * path and without those columns ever leaving the database.
 *
 * A full `HMMonthlyPerformance` row is assignable to it, so nothing that
 * already passes rows had to change.
 */
export type HmMonthlyRecord = Pick<
  HMMonthlyPerformance,
  | "hm_id"
  | "month_id"
  | "net_units"
  | "target_net_units"
  | "recruitment"
  | "active_hp"
  | "shi_percentage"
  | "extrade_units"
  | "non_extrade_units"
>;

/** The weekly Key-In columns the engine reads. See `HmMonthlyRecord`. */
export type HmWeeklyRecord = Pick<
  HMWeeklyPerformance,
  "hm_id" | "week_id" | "keyin_units"
>;

// -----------------------------------------------------------------------------
// Shapes the engine consumes
// -----------------------------------------------------------------------------

/** The identity half of an HM, carried through so the UI needs no second join. */
export type HmProfileInput = {
  hmId: string;
  hmName: string;
  office: string;
  photoUrl: string | null;
  /** `hms.status` today, not "was active during this month". See `selectHmsForMonth`. */
  isActive: boolean;
  /** Tie-break for ranking, and the display order of everything else. */
  displayOrder: number;
};

/** The monthly figures, with blanks preserved. `null` throughout means no row. */
export type HmMonthlyInput = {
  netUnits: Entry;
  targetNetUnits: Entry;
  recruitment: Entry;
  activeHp: Entry;
  /** Keyed in from eTrust. Never calculated, never rolled up. */
  shiPct: Entry;
  extradeUnits: Entry;
  nonExtradeUnits: Entry;
};

export type SalesWeekInput = {
  weekId: string;
  weekNumber: number;
  weekLabel: string;
  /** ISO dates, straight from `sales_weeks`. Never derived from the month. */
  startDate: string;
  endDate: string;
};

/** One HM whole month: who they are, what was keyed in, week by week. */
export type HmMonthInput = {
  hm: HmProfileInput;
  /** `null` when `hm_monthly_performance` has no row for this HM and month. */
  monthly: HmMonthlyInput | null;
  /** Keyed by `sales_weeks.id`. A missing key is a blank week, not a zero one. */
  weeklyKeyIn: Readonly<Record<string, number>>;
};

/** A reporting month, reduced to what the engine actually reasons about. */
export type MonthInput = {
  monthId: string;
  year: number;
  /** 1-12. */
  month: number;
  label: string;
  /** 1-4, derived from `month`. Kept because the database already derives it. */
  quarter: number;
};

// -----------------------------------------------------------------------------
// Row -> input
// -----------------------------------------------------------------------------

export function toHmProfileInput(hm: HM): HmProfileInput {
  return {
    hmId: hm.id,
    hmName: hm.name,
    office: hm.office,
    photoUrl: hm.photo_url,
    isActive: hm.status === "active",
    displayOrder: hm.display_order,
  };
}

export function toHmMonthlyInput(row: HmMonthlyRecord): HmMonthlyInput {
  return {
    netUnits: row.net_units,
    targetNetUnits: row.target_net_units,
    recruitment: row.recruitment,
    activeHp: row.active_hp,
    // numeric(5,2) can arrive as a string from PostgREST depending on the
    // driver, so it is normalised here rather than at seven call sites.
    shiPct: Number(row.shi_percentage),
    extradeUnits: row.extrade_units,
    nonExtradeUnits: row.non_extrade_units,
  };
}

/** Every monthly figure blank - what an HM with no row for the month looks like. */
export const EMPTY_MONTHLY_INPUT: HmMonthlyInput = {
  netUnits: null,
  targetNetUnits: null,
  recruitment: null,
  activeHp: null,
  shiPct: null,
  extradeUnits: null,
  nonExtradeUnits: null,
};

export function toSalesWeekInput(week: SalesWeek): SalesWeekInput {
  return {
    weekId: week.id,
    weekNumber: week.week_number,
    weekLabel: week.week_label?.trim() || `W${week.week_number}`,
    startDate: week.start_date,
    endDate: week.end_date,
  };
}

export function toMonthInput(month: Month): MonthInput {
  return {
    monthId: month.id,
    year: month.year,
    month: month.month,
    label: month.label,
    quarter: month.quarter,
  };
}

// -----------------------------------------------------------------------------
// Which HMs a month is calculated over
// -----------------------------------------------------------------------------

/**
 * The HMs a given month figures cover.
 *
 * Two rules, and they only look like one rule because most months they agree:
 *
 *   1. Every currently active HM is in. They are the people being managed, and
 *      an active HM with nothing entered has to appear so the completeness
 *      model can say their record is missing.
 *
 *   2. An inactive HM is in *if and only if* they have data for this month -
 *      a monthly row or any weekly Key-In. Someone who left in September still
 *      sold in August, and August group Net is wrong without them. Filtering
 *      every month by today `hms.status` would quietly rewrite history each
 *      time somebody is deactivated, which is the one thing historical
 *      reporting cannot survive.
 *
 * An inactive HM with no data for the month is excluded outright: they are not
 * a missing record, they simply were not there.
 *
 * The consequence worth knowing: in the month somebody is deactivated, their
 * partial figures still count towards the group total, because those units were
 * genuinely sold. They are flagged `isActive: false` on the calculated model so
 * a UI can show them differently, and they are never counted as an expected
 * record by `calculateDataCompleteness`.
 */
export function selectHmsForMonth(
  hms: readonly HM[],
  monthly: readonly Pick<HMMonthlyPerformance, "hm_id">[],
  weekly: readonly Pick<HMWeeklyPerformance, "hm_id">[],
): HM[] {
  const withData = new Set<string>([
    ...monthly.map((row) => row.hm_id),
    ...weekly.map((row) => row.hm_id),
  ]);

  return hms.filter((hm) => hm.status === "active" || withData.has(hm.id));
}

// -----------------------------------------------------------------------------
// Assembling the month
// -----------------------------------------------------------------------------

export type MonthRecords = {
  hms: readonly HM[];
  weeks: readonly SalesWeek[];
  monthly: readonly HmMonthlyRecord[];
  weekly: readonly HmWeeklyRecord[];
};

/**
 * Raw month records -> one `HmMonthInput` per HM, in display order.
 *
 * Indexes both performance tables once instead of scanning them per HM: the
 * engine runs over every HM for every month of a quarter, and a nested scan
 * there is the same N+1 shape as querying per row, just in memory.
 *
 * `weekly` is filtered to the month own week ids. Callers that fetch a whole
 * quarter in one query hand over every week of every month, and an unfiltered
 * pass would fold July Key-In into September total.
 */
export function buildHmMonthInputs(records: MonthRecords): HmMonthInput[] {
  const monthWeekIds = new Set(records.weeks.map((week) => week.id));

  const monthlyByHm = new Map(
    records.monthly.map((row) => [row.hm_id, row] as const),
  );

  const weeklyByHm = new Map<string, Record<string, number>>();

  for (const row of records.weekly) {
    if (!monthWeekIds.has(row.week_id)) {
      continue;
    }

    const cells = weeklyByHm.get(row.hm_id) ?? {};
    cells[row.week_id] = row.keyin_units;
    weeklyByHm.set(row.hm_id, cells);
  }

  const hms = selectHmsForMonth(records.hms, records.monthly, records.weekly);

  return hms.map((hm) => {
    const saved = monthlyByHm.get(hm.id);

    return {
      hm: toHmProfileInput(hm),
      monthly: saved ? toHmMonthlyInput(saved) : null,
      weeklyKeyIn: weeklyByHm.get(hm.id) ?? {},
    };
  });
}

/**
 * One named HM's month, whether or not the month "covers" them.
 *
 * `buildHmMonthInputs` answers "who is this month about", and its answer is
 * correct for a group total: an inactive HM with nothing recorded is left out
 * entirely, because they were not there. An individual HM screen asks a
 * different question - "show me this person's September" - and has to work for
 * exactly that HM, including the one the month does not cover, so it can say
 * "nothing was entered" rather than 404 on somebody who plainly exists.
 *
 * So this never filters. It returns the same `HmMonthInput` shape, with
 * `monthly: null` and no weekly cells when there is nothing stored - which is
 * the input that makes every figure read as blank rather than as zero.
 *
 * No index is built: this is one HM, so a scan of the month's rows is cheaper
 * than the Maps `buildHmMonthInputs` needs to avoid a per-HM scan.
 */
export function buildHmMonthInput(
  hm: HM,
  records: Omit<MonthRecords, "hms">,
): HmMonthInput {
  const monthWeekIds = new Set(records.weeks.map((week) => week.id));

  const saved =
    records.monthly.find((row) => row.hm_id === hm.id) ?? null;

  const weeklyKeyIn: Record<string, number> = {};

  for (const row of records.weekly) {
    // Callers that fetch a whole quarter hand over every week of every month,
    // and an unfiltered pass would fold July Key-In into September's total.
    if (row.hm_id !== hm.id || !monthWeekIds.has(row.week_id)) {
      continue;
    }

    weeklyKeyIn[row.week_id] = row.keyin_units;
  }

  return {
    hm: toHmProfileInput(hm),
    monthly: saved ? toHmMonthlyInput(saved) : null,
    weeklyKeyIn,
  };
}
