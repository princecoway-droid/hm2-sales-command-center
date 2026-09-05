/**
 * Test fixtures for the calculation engine.
 *
 * A month of realistic data is five tables deep, and MoM and QTD need the same
 * HMs across several months, so the same object graph gets rebuilt in test after
 * test. These builders describe a month declaratively instead:
 *
 *   const roster = createRoster(["Alpha", "Beta"]);
 *   const september = buildMonthRecords(roster, {
 *     year: 2026, month: 9,
 *     hms: { Alpha: { monthly: { net: 76, target: 100 }, weekly: [20, 18, null, 21] } },
 *   });
 *
 * An HM missing from `hms` has NO monthly row for that month - which is the
 * distinction most of these tests exist to prove, so it has to be easy to
 * express. A `null` in `weekly` is a blank week; a `0` is an entered zero.
 *
 * Every name here is obviously fictional. Production HM names, offices and
 * figures never appear in this repository, in code or in tests.
 */

import { randomUUID } from "node:crypto";

import type {
  GroupMonthlyMetrics,
  HM,
  HMMonthlyPerformance,
  HMWeeklyPerformance,
  Month,
  SalesWeek,
} from "@/types/models";
import type { MonthPerformanceRecords } from "@/lib/view-models/monthly-performance";

const TIMESTAMP = "2026-09-01T00:00:00Z";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// -----------------------------------------------------------------------------
// Roster
// -----------------------------------------------------------------------------

export type HmSpec = {
  name: string;
  status?: "active" | "inactive";
  displayOrder?: number;
  office?: string;
};

/** HMs keyed by name, so a spec can refer to "Alpha" and get a stable uuid. */
export type Roster = Map<string, HM>;

export function createRoster(specs: readonly (string | HmSpec)[]): Roster {
  const roster: Roster = new Map();

  specs.forEach((entry, index) => {
    const spec: HmSpec = typeof entry === "string" ? { name: entry } : entry;

    roster.set(spec.name, {
      id: randomUUID(),
      name: spec.name,
      office: spec.office ?? "Sample Office",
      photo_url: null,
      status: spec.status ?? "active",
      display_order: spec.displayOrder ?? index,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });
  });

  return roster;
}

export function hmId(roster: Roster, name: string): string {
  const hm = roster.get(name);

  if (!hm) {
    throw new Error(`Fixture error: no HM named "${name}" in the roster.`);
  }

  return hm.id;
}

export function rosterList(roster: Roster): HM[] {
  return [...roster.values()];
}

// -----------------------------------------------------------------------------
// A month
// -----------------------------------------------------------------------------

export type MonthlySpec = {
  net?: number;
  target?: number;
  recruitment?: number;
  activeHp?: number;
  shi?: number;
  /** Defaults so the split identity holds: extrade 0, non-extrade all of net. */
  extrade?: number;
  nonExtrade?: number;
};

export type HmMonthSpec = {
  /** Omit entirely for "no monthly record" - not for "a record full of zeros". */
  monthly?: MonthlySpec;
  /** One entry per configured week. `null` is blank, `0` is an entered zero. */
  weekly?: readonly (number | null)[];
};

export type MonthSpec = {
  year: number;
  /** 1-12. */
  month: number;
  /**
   * `[start, end]` ISO pairs. Defaults to five irregular Coway-style periods,
   * the first of which starts in the previous calendar month - deliberately not
   * a tidy 1-7 / 8-14 grid.
   */
  weeks?: readonly (readonly [string, string])[];
  hms: Readonly<Record<string, HmMonthSpec>>;
};

/** Five irregular periods for September 2026, W1 opening on 30 August. */
export const SEPTEMBER_WEEKS = [
  ["2026-08-30", "2026-09-05"],
  ["2026-09-06", "2026-09-12"],
  ["2026-09-13", "2026-09-19"],
  ["2026-09-20", "2026-09-26"],
  ["2026-09-27", "2026-09-30"],
] as const;

/** Four periods, for the months where a fifth would only be noise. */
export const FOUR_WEEKS = [
  ["2026-08-02", "2026-08-08"],
  ["2026-08-09", "2026-08-15"],
  ["2026-08-16", "2026-08-22"],
  ["2026-08-23", "2026-08-29"],
] as const;

export function buildMonth(year: number, month: number): Month {
  return {
    id: randomUUID(),
    year,
    month,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    quarter: Math.floor((month - 1) / 3) + 1,
    created_at: TIMESTAMP,
  };
}

export function buildWeeks(
  monthId: string,
  ranges: readonly (readonly [string, string])[],
): SalesWeek[] {
  return ranges.map(([start, end], index) => ({
    id: randomUUID(),
    month_id: monthId,
    week_number: index + 1,
    week_label: `W${index + 1}`,
    start_date: start,
    end_date: end,
    created_at: TIMESTAMP,
  }));
}

function auditColumns() {
  return {
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    created_by: null,
    updated_by: null,
  };
}

export function buildMonthlyRow(
  hm_id: string,
  month_id: string,
  spec: MonthlySpec,
): HMMonthlyPerformance {
  const net = spec.net ?? 0;
  const extrade = spec.extrade ?? 0;

  return {
    id: randomUUID(),
    hm_id,
    month_id,
    net_units: net,
    target_net_units: spec.target ?? 0,
    recruitment: spec.recruitment ?? 0,
    active_hp: spec.activeHp ?? 0,
    shi_percentage: spec.shi ?? 0,
    extrade_units: extrade,
    // Keeps the database CHECK satisfied by default; override both to break it
    // on purpose.
    non_extrade_units: spec.nonExtrade ?? net - extrade,
    ...auditColumns(),
  };
}

export function buildWeeklyRow(
  hm_id: string,
  week_id: string,
  keyin_units: number,
): HMWeeklyPerformance {
  return {
    id: randomUUID(),
    hm_id,
    week_id,
    keyin_units,
    ...auditColumns(),
  };
}

export function buildGroupMetrics(
  month_id: string,
  shi_percentage: number,
): GroupMonthlyMetrics {
  return {
    id: randomUUID(),
    month_id,
    shi_percentage,
    ...auditColumns(),
  };
}

/**
 * A whole month of records from a spec.
 *
 * Only the HMs named in `spec.hms` get rows. Everyone else on the roster is
 * still passed to the engine through `bundle.hms`, so an active HM with no
 * entry here is exactly the "missing record" case the completeness model has to
 * catch.
 */
export function buildMonthRecords(
  roster: Roster,
  spec: MonthSpec,
): MonthPerformanceRecords {
  const month = buildMonth(spec.year, spec.month);
  const weeks = buildWeeks(month.id, spec.weeks ?? SEPTEMBER_WEEKS);

  const monthly: HMMonthlyPerformance[] = [];
  const weekly: HMWeeklyPerformance[] = [];

  for (const [name, entry] of Object.entries(spec.hms)) {
    const id = hmId(roster, name);

    if (entry.monthly) {
      monthly.push(buildMonthlyRow(id, month.id, entry.monthly));
    }

    (entry.weekly ?? []).forEach((value, index) => {
      const week = weeks[index];

      // A blank week writes NO row - that is how the database stores "not
      // entered", and inventing a 0 row here would test the wrong thing.
      if (value === null || value === undefined || !week) {
        return;
      }

      weekly.push(buildWeeklyRow(id, week.id, value));
    });
  }

  return { month, weeks, monthly, weekly };
}

// -----------------------------------------------------------------------------
// Shortcuts for the engine-level tests
// -----------------------------------------------------------------------------

/** A single-HM month, for testing one calculated model without a whole roster. */
export function singleHmMonth(
  spec: HmMonthSpec & { name?: string; weeks?: MonthSpec["weeks"] } = {},
): {
  roster: Roster;
  name: string;
  records: MonthPerformanceRecords;
} {
  const name = spec.name ?? "Alpha";
  const roster = createRoster([name]);

  return {
    roster,
    name,
    records: buildMonthRecords(roster, {
      year: 2026,
      month: 9,
      weeks: spec.weeks,
      hms: { [name]: { monthly: spec.monthly, weekly: spec.weekly } },
    }),
  };
}
