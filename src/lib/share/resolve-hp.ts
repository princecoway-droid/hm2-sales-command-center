import { formatUnits, isHpActive } from "@/lib/calculations";
import { formatMonthLabel } from "@/lib/validation/month";
import { formatUpdatedAt } from "@/lib/calendar";
import { quarterLabel } from "@/lib/view-models/dashboard";

/**
 * From `resolve_share_hm_hp`'s JSON to one HM's HP list.
 *
 * The whole of the third public read path except the round trip itself, kept
 * pure for the same reason `resolve.ts` and `resolve-hm.ts` are: this is the
 * seam where SQL-built jsonb meets the application, and it is exactly the join
 * a hand-written fixture agrees with and production does not - a key spelled
 * differently, an empty array coming back as `null`.
 *
 * No Supabase client, no `next/headers`, no React: importable from a plain Node
 * test and tested against a REAL payload from a REAL Postgres.
 *
 * ---------------------------------------------------------------------------
 * Why this one does not go through the engine
 * ---------------------------------------------------------------------------
 * Every other share path hands its records to `lib/calculations` and lets the
 * dashboard's own presenter format them, which is what makes a public figure
 * and a private figure the same object. There is nothing to calculate here: an
 * HP row is already W1-W4, a total the database computed, and a Net. The one
 * derived value on the page - whether a row is ACTIVE - is re-asserted against
 * `isHpActive` rather than trusted from the payload, so the badge on a row and
 * the count in the heading cannot come from two different definitions of the
 * threshold.
 */

// -----------------------------------------------------------------------------
// The payload
// -----------------------------------------------------------------------------

/** One HP row, exactly as the function projects it. No ids, no audit columns. */
export type ShareHpRecord = {
  hp_name: string;
  hp_code: string;
  w1_key_in: number;
  w2_key_in: number;
  w3_key_in: number;
  w4_key_in: number;
  total_key_in: number;
  total_net: number;
  is_active: boolean;
};

export type ShareHpPayload = {
  hmId: string;
  hm: {
    id: string;
    name: string;
    office: string;
    photo_url: string | null;
    status: string;
  };
  month: {
    id: string;
    year: number;
    month: number;
    label: string;
    quarter: number;
  };
  hp: ShareHpRecord[];
  /** Counted over the whole month, not over the rows above. */
  hpCount: number;
  activeHp: number;
  lastUpdatedAt: string | null;
};

/**
 * Narrows the RPC's `Json` to a payload, or `null`.
 *
 * Structural rather than a cast: what comes back is whatever the database sent,
 * and this is the one place it becomes a typed value. A payload with no HM or
 * no month is treated as no payload at all rather than rendered half way, and
 * the row list defaults to empty rather than to `undefined` - an HM with no HP
 * data is a real state, and it has to reach the page as an empty list rather
 * than as a crash.
 */
export function parseShareHpPayload(data: unknown): ShareHpPayload | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const raw = data as Record<string, unknown>;

  const hmId = raw.hm_id;
  const hm = raw.hm;
  const month = raw.month;

  if (
    typeof hmId !== "string" ||
    !hm ||
    typeof hm !== "object" ||
    typeof (hm as { name?: unknown }).name !== "string" ||
    !month ||
    typeof month !== "object" ||
    typeof (month as { id?: unknown }).id !== "string"
  ) {
    return null;
  }

  const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  return {
    hmId,
    hm: hm as ShareHpPayload["hm"],
    month: month as ShareHpPayload["month"],
    hp: Array.isArray(raw.hp) ? (raw.hp as ShareHpRecord[]) : [],
    hpCount: count(raw.hp_count),
    activeHp: count(raw.active_hp),
    lastUpdatedAt:
      typeof raw.last_updated_at === "string" ? raw.last_updated_at : null,
  };
}

// -----------------------------------------------------------------------------
// The view model
// -----------------------------------------------------------------------------

export type ShareHpRowModel = {
  /** The HP Code - unique within the month, so it keys the list. */
  key: string;
  hpName: string;
  hpCode: string;
  /** W1-W4, formatted. A week with no Key-In reads as 0, not a blank. */
  weekLabels: [string, string, string, string];
  totalKeyInLabel: string;
  totalNetLabel: string;
  isActive: boolean;
  statusLabel: string;
};

export type ShareHpListViewModel = {
  hm: {
    name: string;
    office: string;
    photoUrl: string | null;
    isActive: boolean;
  };
  monthLabel: string;
  quarterLabel: string;
  /** "18 of 24 HP active this month". The sentence the page is headed with. */
  headline: string;
  activeLabel: string;
  totalLabel: string;
  rows: ShareHpRowModel[];
  /** When the HP figures were last imported, or `null`. */
  updatedLabel: string | null;
  /** Back to that HM's month. Never into the private app. */
  backHref: string;
  /** What to say when the HM has no HP data this month. `null` when they do. */
  emptyMessage: string | null;
  /** Set only when the month holds more rows than the function will return. */
  truncatedMessage: string | null;
};

export type ShareHpListOptions = {
  /** Back to the HM view this list was opened from, under the same token. */
  backHref: string;
};

export function buildShareHpList(
  payload: ShareHpPayload,
  { backHref }: ShareHpListOptions,
): ShareHpListViewModel {
  const rows: ShareHpRowModel[] = payload.hp.map((row) => {
    // Re-asserted rather than trusted: the badge and the heading count must
    // come from one definition of "active", and this is the engine's.
    const active = isHpActive(row.total_key_in);

    return {
      key: row.hp_code,
      hpName: row.hp_name,
      hpCode: row.hp_code,
      weekLabels: [
        formatUnits(row.w1_key_in),
        formatUnits(row.w2_key_in),
        formatUnits(row.w3_key_in),
        formatUnits(row.w4_key_in),
      ],
      totalKeyInLabel: formatUnits(row.total_key_in),
      totalNetLabel: formatUnits(row.total_net),
      isActive: active,
      statusLabel: active ? "Active" : "Inactive",
    };
  });

  return {
    hm: {
      name: payload.hm.name,
      office: payload.hm.office,
      photoUrl: payload.hm.photo_url,
      isActive: payload.hm.status === "active",
    },

    monthLabel:
      payload.month.label?.trim() ||
      formatMonthLabel(payload.month.year, payload.month.month),
    quarterLabel: quarterLabel(payload.month.quarter, payload.month.year),

    headline:
      payload.hpCount === 0
        ? "No HP figures for this month yet"
        : `${formatUnits(payload.activeHp)} of ${formatUnits(payload.hpCount)} HP active this month`,

    activeLabel: formatUnits(payload.activeHp),
    totalLabel: formatUnits(payload.hpCount),

    rows,
    updatedLabel: formatUpdatedAt(payload.lastUpdatedAt),
    backHref,

    emptyMessage:
      payload.hpCount > 0
        ? null
        : "No HP figures have been imported for this month yet.",

    // The function caps what it returns. Saying so is the difference between a
    // short list and a wrong one.
    truncatedMessage:
      payload.hpCount > rows.length && rows.length > 0
        ? `Showing the first ${formatUnits(rows.length)} of ${formatUnits(payload.hpCount)} HP.`
        : null,
  };
}
