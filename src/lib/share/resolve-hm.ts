import type { HmMonthlyRecord, HpActiveRecord } from "@/lib/calculations";
import { parseSharePayload, type SharePayload } from "@/lib/share/resolve";
import type { HmDetailViewModel } from "@/lib/view-models/hm-detail";
import { buildHmDetailViewModel } from "@/lib/view-models/hm-detail";
import {
  buildHmPerformanceViewModel,
  type MonthPerformanceRecords,
} from "@/lib/view-models/monthly-performance";
import type { Month } from "@/types/models";

/**
 * From `resolve_share_hm_report`'s JSON to one HM's month.
 *
 * The public HM read path except the round trip, kept pure for the same reason
 * `resolve.ts` is: this is the seam where SQL-built jsonb meets the calculation
 * engine, and it is exactly the join a hand-written fixture agrees with and
 * production does not - a key spelled differently, a `numeric` arriving as a
 * string, an empty array coming back as `null`. So it is testable against a
 * REAL payload from a REAL Postgres, with no Supabase client, no `next/headers`
 * and no React anywhere in the file.
 *
 * ---------------------------------------------------------------------------
 * Why this is a sibling of `resolve.ts` rather than an edit to it
 * ---------------------------------------------------------------------------
 * `buildShareReport` is what every circulating WhatsApp link runs through. It
 * builds a bundle of exactly ONE month, which is the structural half of "a
 * share link is not a database browser", and that property is worth more than
 * the handful of lines the two files have in common. Nothing here can change
 * what `/share/<token>` renders.
 *
 * The extra months this file DOES accept carry one HM's monthly figures and
 * nothing else - see the migration. They exist so month-over-month and QTD say
 * what the manager's own screen says, and they cannot be assembled into a
 * second group report.
 */

/** One month of context: the previous month, or an earlier month of the quarter. */
export type ShareHmContextMonth = {
  month: Month;
  /** The requested HM's row, or none. Never the roster's. */
  monthly: HmMonthlyRecord[];
  /** The requested HM's Active HP count for that month. Never the roster's. */
  hpActive: HpActiveRecord[];
};

/** Exactly the shape `public.resolve_share_hm_report` builds. */
export type ShareHmPayload = SharePayload & {
  hmId: string;
  context: ShareHmContextMonth[];
};

/**
 * Narrows the RPC's `Json` to a payload, or `null`.
 *
 * The month, weeks, roster and figures are narrowed by `parseSharePayload` -
 * the same function the group report uses, so the two cannot come to disagree
 * about what a payload is. Only the two additions are handled here.
 *
 * A payload with no `hm_id` is treated as no payload at all rather than
 * rendered for nobody, and a context entry without a real month is dropped
 * rather than half-built: a month that cannot be identified cannot be compared
 * against or counted into a quarter.
 */
export function parseShareHmPayload(data: unknown): ShareHmPayload | null {
  const base = parseSharePayload(data);

  if (!base) {
    return null;
  }

  const raw = data as Record<string, unknown>;
  const hmId = raw.hm_id;

  if (typeof hmId !== "string" || hmId.length === 0) {
    return null;
  }

  return { ...base, hmId, context: parseContext(raw.context) };
}

function parseContext(value: unknown): ShareHmContextMonth[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const months: ShareHmContextMonth[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const month = record.month;

    if (
      !month ||
      typeof month !== "object" ||
      typeof (month as Month).id !== "string"
    ) {
      continue;
    }

    months.push({
      month: month as Month,
      monthly: Array.isArray(record.monthly)
        ? (record.monthly as HmMonthlyRecord[])
        : [],
      hpActive: Array.isArray(record.hp_active)
        ? (record.hp_active as HpActiveRecord[])
        : [],
    });
  }

  return months;
}

export type ShareHmDetailOptions = {
  /** Back to the report this HM was opened from. Never into the private app. */
  backHref: string;
  /**
   * Where this screen's Active HP figure opens, for a public reader.
   *
   * `/share/<token>/hm/<id>/hp` - the same HP list the manager sees, under the
   * token that already authorizes this page, and never `/hp`, which is behind a
   * login the reader does not have. `null` leaves the figure unlinked, which is
   * what a caller with no token to build a path from should pass.
   */
  hpListingHref?: string | null;
};

/**
 * One HM's month -> the model the HM detail components already render.
 *
 * The three calls in the middle are the signed-in screen's own: the Stage 3
 * engine through `buildHmPerformanceViewModel`, then the Stage 5 presenter.
 * There is no second engine and no second presenter, so a figure on the public
 * HM view is a figure the private one would show for the same month - not
 * because a test checks it, but because it is the same call.
 *
 * `null` when the payload does not cover the requested HM. That is "not found",
 * which the route turns into the same generic unavailable page every other
 * failure gets.
 */
export function buildShareHmDetail(
  payload: ShareHmPayload,
  { backHref, hpListingHref = null }: ShareHmDetailOptions,
): HmDetailViewModel | null {
  const selected: MonthPerformanceRecords = {
    month: payload.month,
    weeks: payload.weeks,
    monthly: payload.monthly,
    weekly: payload.weekly,
    hpActive: payload.hpActive,
  };

  const model = buildHmPerformanceViewModel(
    {
      selectedMonthId: payload.month.id,
      hms: payload.hms,
      // The token's month in full, then the context months. Those carry no
      // weeks and no weekly Key-In on purpose: month-over-month and QTD are
      // counted from monthly Net and recruitment, and nothing on the screen
      // shows another month's weeks.
      months: [
        selected,
        ...payload.context.map((entry) => ({
          month: entry.month,
          weeks: [],
          monthly: entry.monthly,
          weekly: [],
          hpActive: entry.hpActive,
        })),
      ],
      groupShiPct:
        payload.groupShiPct === null ? null : Number(payload.groupShiPct),
    },
    payload.hmId,
  );

  if (!model) {
    return null;
  }

  return buildHmDetailViewModel({
    selectedMonth: payload.month,
    model,
    lastUpdatedAt: payload.lastUpdatedAt,
    // No notice: the month was decided when the link was created, so there is
    // no "that month could not be opened" story to tell a public viewer.
    notice: null,
    backHref,
    // The one caller that is not the signed-in screen. `public` strips the HM
    // Code from the MODEL, so no component rendering this can put an internal
    // identifier in front of a WhatsApp recipient.
    audience: "public",
    // The Active HP figure still links - to the PUBLIC list, under this
    // token. The presenter does not know which world it is in; the caller that
    // holds the token decides, which is why no route into the private app can
    // reach a public model even by accident.
    hpListingHref,
  });
}
