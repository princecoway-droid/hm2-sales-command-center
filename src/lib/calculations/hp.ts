import type { Entry } from "@/lib/calculations/performance";

/**
 * HP-level figures.
 *
 * Two numbers and one threshold, and every surface in the application reads
 * them from here: the import preview, the import commit, the HP listing, the
 * HM card, the dashboard KPI and the shared report. There is deliberately no
 * second place that adds four weeks together or decides what "active" means.
 *
 * Pure, like the rest of the engine: no Supabase, no React, no clock.
 *
 * ---------------------------------------------------------------------------
 * What is NOT here
 * ---------------------------------------------------------------------------
 * No weekly incentive, no target engine, no forecast. W1-W4 exist because the
 * PA's spreadsheet already carries them and because an HM can read momentum off
 * them; they are performance detail, not an input to a calculation the business
 * has not defined.
 */

// -----------------------------------------------------------------------------
// Total Key-In
// -----------------------------------------------------------------------------

/**
 * The month's Total Key-In for one HP: W1 + W2 + W3 + W4.
 *
 * A blank weekly cell counts as 0 HERE and only here. That is not the
 * application relaxing its "blank is not zero" rule - it is the rule the
 * business states for this dataset: an HP with no figure in W3 sold nothing in
 * W3, because the spreadsheet is a complete record of the month rather than a
 * form somebody is part way through filling in.
 *
 * The Excel carries its own TOTAL KEY-IN column. It is cross-checked against
 * this figure at import time and then discarded: what gets stored is always
 * this sum, and a database CHECK refuses a row where the two disagree.
 */
export function calculateHpTotalKeyIn(
  w1: Entry | undefined,
  w2: Entry | undefined,
  w3: Entry | undefined,
  w4: Entry | undefined,
): number {
  return [w1, w2, w3, w4].reduce<number>(
    (total, week) =>
      total + (week === null || week === undefined ? 0 : week),
    0,
  );
}

// -----------------------------------------------------------------------------
// Active
// -----------------------------------------------------------------------------

/**
 * One key-in makes an HP active for the month.
 *
 * The whole definition, in one constant, because it is the number the
 * dashboard's Active HP KPI ultimately rests on.
 */
export const HP_ACTIVE_THRESHOLD = 1;

/** An HP is ACTIVE for the month when their Total Key-In is at least 1. */
export function isHpActive(totalKeyIn: number): boolean {
  return totalKeyIn >= HP_ACTIVE_THRESHOLD;
}

// -----------------------------------------------------------------------------
// Active HP per HM
// -----------------------------------------------------------------------------

/**
 * The database's own count for one HM and month.
 *
 * `hpCount` is not decoration. An HM with HP rows and none of them active has
 * Active HP 0 - a real, entered zero. An HM with no HP rows at all has no
 * figure, and printing 0 for them would say the month was a failure when
 * nothing has been imported yet. The presence of a record is what tells the two
 * apart, so it travels with the count.
 */
export type HpActiveRecord = {
  hm_id: string;
  hp_count: number;
  active_hp: number;
};

/**
 * Active HP for one HM, as an `Entry` - a number, or `null` for "no HP data".
 *
 * The single conversion from "what the database counted" to "what the engine
 * reasons about". Nothing downstream may turn a missing record into a 0.
 */
export function hpActiveEntry(
  record: HpActiveRecord | undefined | null,
): Entry {
  if (!record || record.hp_count <= 0) {
    return null;
  }

  return record.active_hp;
}

/** The month's counts, keyed by HM id. Built once per month, not per HM. */
export function indexHpActiveByHm(
  records: readonly HpActiveRecord[],
): Map<string, HpActiveRecord> {
  return new Map(records.map((record) => [record.hm_id, record] as const));
}

// -----------------------------------------------------------------------------
// Counting a set of HP rows
// -----------------------------------------------------------------------------

/** The minimum an HP row has to carry for the counts below. */
export type HpTotalsRow = {
  totalKeyIn: number;
};

export type HpMonthTotals = {
  /** HP rows counted. */
  total: number;
  /** Total Key-In at or above the threshold. */
  active: number;
  /** The rest. Blank weeks make a Total Key-In of 0, which is inactive. */
  inactive: number;
};

/**
 * Active and inactive counts over a set of HP rows.
 *
 * Used by the import preview, by the import result and by the HP listing
 * header, so those three can never disagree about how many HPs were active in
 * a month they are all describing.
 */
export function summariseHpRows(
  rows: readonly HpTotalsRow[],
): HpMonthTotals {
  const active = rows.filter((row) => isHpActive(row.totalKeyIn)).length;

  return {
    total: rows.length,
    active,
    inactive: rows.length - active,
  };
}
