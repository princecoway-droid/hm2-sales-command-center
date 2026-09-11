import { formatMonthLabel } from "@/lib/validation/month";
import type { Month, SalesWeek } from "@/types/models";

/**
 * Month and sales-week helpers.
 *
 * Pure, and deliberately not `server-only`: the month selector runs in the
 * browser and the page that renders it runs on the server, and both need the
 * same answer to "which month is next". Anything that touches Supabase belongs
 * in `lib/data/` instead.
 */

// -----------------------------------------------------------------------------
// Choosing a month
// -----------------------------------------------------------------------------

/**
 * Which month the data-entry screen should open on.
 *
 * Preference order: the one asked for, then today's, then the most recent that
 * exists. Falling back rather than erroring matters at the turn of a month,
 * when nobody has opened the new one yet - the PA lands on the latest month
 * that has figures instead of an empty screen.
 *
 * `months` is expected newest-first, as `listMonths()` returns it.
 */
export function resolveSelectedMonth(
  months: readonly Month[],
  requestedId: string | undefined,
  today: Date = new Date(),
): Month | null {
  if (months.length === 0) {
    return null;
  }

  if (requestedId) {
    const requested = months.find((month) => month.id === requestedId);

    if (requested) {
      return requested;
    }
  }

  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const current = months.find(
    (month) => month.year === currentYear && month.month === currentMonth,
  );

  return current ?? months[0] ?? null;
}

// -----------------------------------------------------------------------------
// The month in the URL
// -----------------------------------------------------------------------------

/**
 * What a `?month=` parameter can name.
 *
 * `YYYY-MM` is the form the dashboard writes, because it survives everything a
 * uuid does not: it is readable in a shared link, it means the same thing in
 * every environment, and it still resolves after a month row is recreated.
 * A raw month id is accepted too, so a link handed over from the data-entry
 * screen (which is keyed by id) does not dead-end.
 */
export type MonthRequest =
  | { kind: "yearMonth"; year: number; month: number }
  | { kind: "id"; id: string };

const YEAR_MONTH = /^(\d{4})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?month=2026-09` -> the September 2026 request. Anything unrecognised is
 * `null`, never a guess: a malformed parameter has to be distinguishable from
 * an absent one so the page can say the link was wrong instead of silently
 * showing a different month.
 */
export function parseMonthParam(raw: string | undefined | null): MonthRequest | null {
  if (typeof raw !== "string") {
    return null;
  }

  const value = raw.trim();
  const matched = YEAR_MONTH.exec(value);

  if (matched) {
    const year = Number(matched[1]);
    const month = Number(matched[2]);

    // Range-checked here rather than at the database: `2026-13` is a broken
    // link, and a query for it would only come back empty and look like a month
    // nobody has opened.
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
      return { kind: "yearMonth", year, month };
    }

    return null;
  }

  return UUID.test(value) ? { kind: "id", id: value } : null;
}

/** The value the dashboard puts in the URL for a month: "2026-09". */
export function monthParam(month: Pick<Month, "year" | "month">): string {
  return `${month.year}-${String(month.month).padStart(2, "0")}`;
}

function findRequestedMonth(
  months: readonly Month[],
  request: MonthRequest,
): Month | null {
  if (request.kind === "id") {
    return months.find((month) => month.id === request.id) ?? null;
  }

  return (
    months.find(
      (month) => month.year === request.year && month.month === request.month,
    ) ?? null
  );
}

/**
 * Why the dashboard is showing the month it is showing.
 *
 * The reason is carried, not just the month, because three of these four have
 * to be visible on screen. "September has not been opened yet, so this is
 * August" and "this is September" are different claims about the business, and
 * a dashboard that silently rendered the first as the second would have a
 * manager reading last month's figures as this month's.
 */
export type MonthResolutionSource =
  /** The month named in the URL. */
  | "requested"
  /** No month asked for, and today's month exists. The normal case. */
  | "current"
  /** Today's month has not been opened; showing the most recent that has. */
  | "fallback"
  /** The URL named a month that does not exist, or was malformed. */
  | "invalid";

export type MonthResolution = {
  month: Month | null;
  source: MonthResolutionSource;
  /** Today's reporting month, whether or not it has been opened. */
  currentYearMonth: { year: number; month: number };
  /** False when today's month has no row - the "not configured" state. */
  currentMonthExists: boolean;
};

/**
 * Which month the dashboard opens on.
 *
 * Order: the month asked for, then today's, then the most recent that exists.
 * The current month is resolved from the clock rather than from a constant, so
 * nothing here needs changing when October arrives.
 *
 * `months` is expected newest-first, as `listMonths()` and `getDashboardData()`
 * both return it.
 */
export function resolveDashboardMonth(
  months: readonly Month[],
  requested: MonthRequest | null,
  { today = new Date(), requestWasMalformed = false } = {},
): MonthResolution {
  const currentYearMonth = {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  };

  const current = findCurrentMonth(months, today);

  const base = {
    currentYearMonth,
    currentMonthExists: current !== null,
  };

  if (months.length === 0) {
    return { month: null, source: requestWasMalformed ? "invalid" : "current", ...base };
  }

  if (requested) {
    const found = findRequestedMonth(months, requested);

    if (found) {
      return { month: found, source: "requested", ...base };
    }
  }

  // A link that named a month nobody has opened is not the same as no link at
  // all: fall back to something real, and say so.
  const askedForSomethingMissing = requestWasMalformed || requested !== null;

  const fallback = current ?? months[0] ?? null;

  if (askedForSomethingMissing) {
    return { month: fallback, source: "invalid", ...base };
  }

  return {
    month: fallback,
    source: current ? "current" : "fallback",
    ...base,
  };
}

/** Oldest first. The order the prev/next controls step through. */
export function sortMonthsAscending(months: readonly Month[]): Month[] {
  return [...months].sort((a, b) =>
    a.year === b.year ? a.month - b.month : a.year - b.year,
  );
}

/**
 * The months either side of the selected one.
 *
 * Neighbours are the adjacent *existing* months rather than calendar
 * arithmetic: a month nobody has created has nothing to show, so the control is
 * disabled instead of navigating somewhere empty.
 */
export function findMonthNeighbours(
  months: readonly Month[],
  selectedId: string,
): { previous: Month | null; next: Month | null } {
  const ascending = sortMonthsAscending(months);
  const index = ascending.findIndex((month) => month.id === selectedId);

  if (index === -1) {
    return { previous: null, next: null };
  }

  return {
    previous: ascending[index - 1] ?? null,
    next: ascending[index + 1] ?? null,
  };
}

/** Today's reporting month, if it has been created. */
export function findCurrentMonth(
  months: readonly Month[],
  today: Date = new Date(),
): Month | null {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  return (
    months.find((entry) => entry.year === year && entry.month === month) ?? null
  );
}

/** The label a month row carries, falling back to deriving it. */
export function monthLabel(month: Month): string {
  return month.label?.trim() || formatMonthLabel(month.year, month.month);
}

// -----------------------------------------------------------------------------
// Sales weeks
// -----------------------------------------------------------------------------

/**
 * The next free week number, or null when all six are used.
 *
 * Gaps are filled before extending, so deleting W3 and adding a week gives back
 * W3 rather than W6 - the numbers stay contiguous, which is what the grid
 * columns and the W<n> labels assume.
 */
export function nextAvailableWeekNumber(
  weeks: readonly { week_number: number }[],
  max = 6,
): number | null {
  const used = new Set(weeks.map((week) => week.week_number));

  for (let candidate = 1; candidate <= max; candidate += 1) {
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * A suggested date range for a newly added week.
 *
 * A convenience only. Coway publishes the official periods and the PA types
 * them in; this just saves keystrokes by proposing the seven days after the
 * last configured week, and is always overwritable. Nothing downstream may
 * assume a week is seven days long, or that it lines up with the calendar month.
 */
export function suggestWeekRange(
  weeks: readonly { end_date: string }[],
  month: Pick<Month, "year" | "month">,
): { start_date: string; end_date: string } {
  const lastEnd = weeks
    .map((week) => week.end_date)
    .sort((a, b) => a.localeCompare(b))
    .at(-1);

  const start = lastEnd
    ? addDays(lastEnd, 1)
    : toIsoDate(new Date(Date.UTC(month.year, month.month - 1, 1)));

  return { start_date: start, end_date: addDays(start, 6) };
}

/** `2026-09-30` + 1 -> `2026-10-01`. UTC throughout, so no timezone drift. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);

  return toIsoDate(date);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The timezone the business runs in.
 *
 * Pinned rather than left to the host. A dashboard rendered on a server in UTC
 * would stamp "Updated 17:04" on a save made at 01:04 the next morning in Kuala
 * Lumpur, and the manager reading it has no way to tell.
 */
export const REPORTING_TIME_ZONE = "Asia/Kuala_Lumpur";

/**
 * Today, as the reporting office would write it: `2026-09-08`.
 *
 * The one conversion from a clock to a date the engine can compare against a
 * Coway period. It matters at both ends of a day: a server running in UTC is
 * eight hours behind Kuala Lumpur, so a page rendered at 07:00 on the 6th would
 * otherwise resolve the current week as though it were still the 5th - the last
 * day of W1 - and show the wrong week's Key-In status all morning.
 *
 * `en-CA` is used only because it formats as `YYYY-MM-DD`; the timezone is the
 * point of the call.
 */
export function reportingDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: REPORTING_TIME_ZONE,
  }).format(date);
}

/**
 * An audit timestamp as the office reads it: "4 Sep 2026, 14:32".
 *
 * Formatted on the server and sent as text, so the browser never has to agree
 * with it. Returns `null` for a missing or unparseable timestamp; the caller
 * decides what "never updated" should say.
 */
export function formatUpdatedAt(isoTimestamp: string | null): string | null {
  if (!isoTimestamp) {
    return null;
  }

  const date = new Date(isoTimestamp);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: REPORTING_TIME_ZONE,
  }).format(date);
}

/** `2026-09-05` -> "05/09/2026", the format the Coway calendar is published in. */
export function formatDayMonthYear(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");

  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

/** Short header form for a grid column, e.g. "30 Aug – 5 Sep". */
export function formatWeekRange(week: Pick<SalesWeek, "start_date" | "end_date">): string {
  return `${formatShortDay(week.start_date)} – ${formatShortDay(week.end_date)}`;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatShortDay(isoDate: string): string {
  const [, month, day] = isoDate.split("-").map(Number);

  if (!month || !day) {
    return isoDate;
  }

  return `${day} ${SHORT_MONTHS[month - 1] ?? ""}`.trim();
}
