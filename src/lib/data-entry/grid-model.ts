import {
  isEntered,
  type Entry,
  type CompletenessRow,
} from "@/lib/calculations/performance";
import {
  gridRowSchema,
  weeklyCellField,
  type GridRowDraft,
} from "@/lib/validation/data-entry";
import type {
  GroupMonthlyMetrics,
  HM,
  HMMonthlyPerformance,
  HMWeeklyPerformance,
  SalesWeek,
} from "@/types/models";

/**
 * The editable model behind the spreadsheet.
 *
 * Pure and framework-free, so the rules that decide what is dirty, what is
 * invalid and what gets sent can be tested without rendering anything.
 *
 * ---------------------------------------------------------------------------
 * Why cells hold strings
 * ---------------------------------------------------------------------------
 * A cell stores exactly what the PA typed, not a parsed number. Holding numbers
 * instead forces a second, hidden copy of the raw text - otherwise `72.` cannot
 * be typed on the way to `72.5`, and a pasted `-5` either vanishes silently or
 * has to round-trip through NaN. With strings there is one source of truth:
 * parsing happens in `toEntry`, and anything that fails to parse becomes a
 * visible cell error rather than a value the grid quietly dropped.
 *
 * Empty string means "not entered" and maps to `null`. `"0"` means a real zero.
 * Nothing here may collapse the two.
 * ---------------------------------------------------------------------------
 */

export const MONTHLY_FIELDS = [
  "net_units",
  "target_net_units",
  "recruitment",
  "active_hp",
  "shi_percentage",
  "extrade_units",
  "non_extrade_units",
] as const;

export type MonthlyField = (typeof MONTHLY_FIELDS)[number];

/** SHI is the only figure with decimals; everything else counts whole units. */
export const DECIMAL_FIELDS: ReadonlySet<MonthlyField> = new Set([
  "shi_percentage",
]);

export type RowDraft = {
  hmId: string;
  monthly: Record<MonthlyField, string>;
  /** Keyed by `sales_weeks.id` - never by week number, which can be renumbered. */
  weekly: Record<string, string>;
};

export type GridDraft = {
  rows: Record<string, RowDraft>;
  /** Straight from eTrust. Never derived from the HM SHI column. */
  groupShi: string;
};

// -----------------------------------------------------------------------------
// Text <-> value
// -----------------------------------------------------------------------------

export type ParsedEntry =
  | { ok: true; value: Entry }
  | { ok: false; text: string };

const NUMERIC = /^-?\d*\.?\d*$/;

/**
 * Parses a cell.
 *
 * A lone `-`, `.` or `-.` parses as "not entered" rather than as a failure:
 * they are the states a value passes through while being typed, and flashing an
 * error at someone mid-keystroke is noise.
 */
export function toEntry(text: string): ParsedEntry {
  const trimmed = text.trim();

  if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") {
    return { ok: true, value: null };
  }

  if (!NUMERIC.test(trimmed)) {
    return { ok: false, text: trimmed };
  }

  const value = Number(trimmed);

  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false, text: trimmed };
}

/** The value a parsed cell contributes, or null when it does not parse. */
export function entryValue(parsed: ParsedEntry): Entry {
  return parsed.ok ? parsed.value : null;
}

/** `87.5` -> "87.5", `null` -> "". Trailing zeros from numeric(5,2) are dropped. */
export function entryToText(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(Number(value));
}

// -----------------------------------------------------------------------------
// Building the draft from what the database returned
// -----------------------------------------------------------------------------

export type WorkbookInput = {
  hms: readonly HM[];
  weeks: readonly SalesWeek[];
  monthly: readonly HMMonthlyPerformance[];
  weekly: readonly HMWeeklyPerformance[];
  groupMetrics: GroupMonthlyMetrics | null;
};

/**
 * The saved state of the month, as grid text.
 *
 * An HM with no monthly row gets blank cells, not zeros. That is the whole
 * point of the blank/zero distinction: "nobody has entered September for this
 * HM" and "September was genuinely zero" must not look the same, either to the
 * PA or to the completeness indicator.
 */
export function buildDraft(workbook: WorkbookInput): GridDraft {
  const monthlyByHm = new Map(
    workbook.monthly.map((row) => [row.hm_id, row] as const),
  );
  const weeklyByKey = new Map(
    workbook.weekly.map((row) => [`${row.hm_id}:${row.week_id}`, row] as const),
  );

  const rows: Record<string, RowDraft> = {};

  for (const hm of workbook.hms) {
    const saved = monthlyByHm.get(hm.id);

    const monthly = Object.fromEntries(
      MONTHLY_FIELDS.map((field) => [
        field,
        saved ? entryToText(saved[field]) : "",
      ]),
    ) as Record<MonthlyField, string>;

    const weekly: Record<string, string> = {};

    for (const week of workbook.weeks) {
      const cell = weeklyByKey.get(`${hm.id}:${week.id}`);
      weekly[week.id] = cell ? entryToText(cell.keyin_units) : "";
    }

    rows[hm.id] = { hmId: hm.id, monthly, weekly };
  }

  return {
    rows,
    groupShi: entryToText(workbook.groupMetrics?.shi_percentage ?? null),
  };
}

// -----------------------------------------------------------------------------
// Reading a row
// -----------------------------------------------------------------------------

export type RowValues = {
  hm_id: string;
  net_units: Entry;
  target_net_units: Entry;
  recruitment: Entry;
  active_hp: Entry;
  shi_percentage: Entry;
  extrade_units: Entry;
  non_extrade_units: Entry;
  weekly: { week_id: string; keyin_units: Entry }[];
};

/** Parsed values for one row, in the shape the schemas and calculations take. */
export function rowValues(
  draft: RowDraft,
  weeks: readonly SalesWeek[],
): RowValues {
  const monthly = Object.fromEntries(
    MONTHLY_FIELDS.map((field) => [
      field,
      entryValue(toEntry(draft.monthly[field] ?? "")),
    ]),
  ) as Record<MonthlyField, Entry>;

  return {
    hm_id: draft.hmId,
    ...monthly,
    weekly: weeks.map((week) => ({
      week_id: week.id,
      keyin_units: entryValue(toEntry(draft.weekly[week.id] ?? "")),
    })),
  };
}

/** Just the weekly figures, in configured week order, for `sumKeyIn`. */
export function weeklyEntries(
  draft: RowDraft,
  weeks: readonly SalesWeek[],
): Entry[] {
  return weeks.map((week) => entryValue(toEntry(draft.weekly[week.id] ?? "")));
}

/** The shape the completeness summary needs. */
export function toCompletenessRow(
  draft: RowDraft,
  weeks: readonly SalesWeek[],
): CompletenessRow {
  const values = rowValues(draft, weeks);

  return {
    hmId: draft.hmId,
    net_units: values.net_units,
    target_net_units: values.target_net_units,
    recruitment: values.recruitment,
    active_hp: values.active_hp,
    shi_percentage: values.shi_percentage,
    extrade_units: values.extrade_units,
    non_extrade_units: values.non_extrade_units,
    weekly: values.weekly.map((cell) => cell.keyin_units),
  };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/** Cell key -> message. Keys match the `data-field` on the inputs. */
export type RowErrors = Record<string, string>;

const FIELD_LABELS: Record<MonthlyField, string> = {
  net_units: "Net units",
  target_net_units: "Target",
  recruitment: "Recruitment",
  active_hp: "Active HP",
  shi_percentage: "SHI",
  extrade_units: "Extrade units",
  non_extrade_units: "Non-Extrade units",
};

/**
 * Validates one row as it stands.
 *
 * Unparseable text is caught first and reported per cell, because the schema
 * below can only speak about numbers - handing it a `null` that really means
 * "the PA typed `12a`" would report the row as valid.
 *
 * Everything else defers to `gridRowSchema`, the same schema the Server Action
 * re-runs. The grid never restates a rule; it only decides where to show it.
 */
export function validateRow(
  draft: RowDraft,
  weeks: readonly SalesWeek[],
): RowErrors {
  const errors: RowErrors = {};

  for (const field of MONTHLY_FIELDS) {
    if (!toEntry(draft.monthly[field] ?? "").ok) {
      errors[field] = `${FIELD_LABELS[field]} must be a number.`;
    }
  }

  for (const week of weeks) {
    const parsed = toEntry(draft.weekly[week.id] ?? "");

    if (!parsed.ok) {
      errors[weeklyCellField(week.id)] = "Key-In must be a number.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return errors;
  }

  const values = rowValues(draft, weeks);
  const result = gridRowSchema.safeParse(values satisfies GridRowDraft);

  if (result.success) {
    return errors;
  }

  for (const issue of result.error.issues) {
    const path = issue.path;
    const head = String(path[0] ?? "");

    // Weekly issues arrive as ["weekly", index, "keyin_units"].
    if (head === "weekly" && typeof path[1] === "number") {
      const week = weeks[path[1]];

      if (week) {
        errors[weeklyCellField(week.id)] ??= issue.message;
      }

      continue;
    }

    errors[head] ??= issue.message;
  }

  return errors;
}

// -----------------------------------------------------------------------------
// Dirty tracking
// -----------------------------------------------------------------------------

/**
 * Compares parsed values, not text.
 *
 * `87.50` and `87.5` are the same figure; treating them as a change would arm
 * the unsaved-changes warning for someone who only re-typed what was already
 * there.
 */
export function isRowDirty(
  draft: RowDraft,
  baseline: RowDraft | undefined,
  weeks: readonly SalesWeek[],
): boolean {
  if (!baseline) {
    return true;
  }

  for (const field of MONTHLY_FIELDS) {
    if (
      !sameEntry(
        toEntry(draft.monthly[field] ?? ""),
        toEntry(baseline.monthly[field] ?? ""),
      )
    ) {
      return true;
    }
  }

  for (const week of weeks) {
    if (
      !sameEntry(
        toEntry(draft.weekly[week.id] ?? ""),
        toEntry(baseline.weekly[week.id] ?? ""),
      )
    ) {
      return true;
    }
  }

  return false;
}

function sameEntry(a: ParsedEntry, b: ParsedEntry): boolean {
  if (!a.ok || !b.ok) {
    return a.ok === b.ok && (a.ok ? true : a.text === (b as { text: string }).text);
  }

  return a.value === b.value;
}

/** Ids of the rows that changed, in the order the HMs are displayed. */
export function dirtyRowIds(
  draft: GridDraft,
  baseline: GridDraft,
  hms: readonly HM[],
  weeks: readonly SalesWeek[],
): string[] {
  return hms
    .map((hm) => hm.id)
    .filter((hmId) => {
      const row = draft.rows[hmId];

      return row ? isRowDirty(row, baseline.rows[hmId], weeks) : false;
    });
}

export function isGroupShiDirty(draft: GridDraft, baseline: GridDraft): boolean {
  return !sameEntry(toEntry(draft.groupShi), toEntry(baseline.groupShi));
}

// -----------------------------------------------------------------------------
// Clearing a saved weekly figure
// -----------------------------------------------------------------------------

/**
 * Cells blanked out that already have a figure in the database.
 *
 * Removing Key-In is manager-only under the Stage 1 RLS policy, and a DELETE
 * that RLS filters does not raise - it just affects nothing. Detecting the case
 * here means a PA is told what happened instead of watching the value reappear
 * after the page refreshes.
 */
export function findClearedSavedWeeks(
  draft: GridDraft,
  baseline: GridDraft,
  hms: readonly HM[],
  weeks: readonly SalesWeek[],
): { hmId: string; weekId: string }[] {
  const cleared: { hmId: string; weekId: string }[] = [];

  for (const hm of hms) {
    const row = draft.rows[hm.id];
    const before = baseline.rows[hm.id];

    if (!row || !before) {
      continue;
    }

    for (const week of weeks) {
      const now = entryValue(toEntry(row.weekly[week.id] ?? ""));
      const then = entryValue(toEntry(before.weekly[week.id] ?? ""));

      if (!isEntered(now) && isEntered(then)) {
        cleared.push({ hmId: hm.id, weekId: week.id });
      }
    }
  }

  return cleared;
}

/**
 * Only the weekly cells whose value actually changed.
 *
 * Sending every week for a row that was edited elsewhere would re-upsert
 * untouched Key-In, bumping `updated_at` and `updated_by` on rows nobody
 * touched - which turns the audit trail into noise the first time someone tries
 * to work out who changed what.
 */
export function changedWeeklyCells(
  draft: RowDraft,
  baseline: RowDraft | undefined,
  weeks: readonly SalesWeek[],
): { week_id: string; keyin_units: Entry }[] {
  return weeks
    .filter((week) => {
      const now = toEntry(draft.weekly[week.id] ?? "");
      const before = toEntry(baseline?.weekly[week.id] ?? "");

      return !sameEntry(now, before);
    })
    .map((week) => ({
      week_id: week.id,
      keyin_units: entryValue(toEntry(draft.weekly[week.id] ?? "")),
    }));
}

/** The monthly half of a row, parsed, for the save payload. */
export function monthlyValues(draft: RowDraft): Record<MonthlyField, Entry> {
  return Object.fromEntries(
    MONTHLY_FIELDS.map((field) => [
      field,
      entryValue(toEntry(draft.monthly[field] ?? "")),
    ]),
  ) as Record<MonthlyField, Entry>;
}
