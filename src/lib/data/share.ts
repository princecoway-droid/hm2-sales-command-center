import "server-only";

import { readErrorMessage } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { SHARE_LINK_EXPIRY_DAYS } from "@/lib/share/config";
import { buildShareReport, parseSharePayload } from "@/lib/share/resolve";
import {
  generateShareToken,
  isShareTokenShaped,
  shareLinkExpiry,
} from "@/lib/share/token";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicShareViewModel } from "@/lib/view-models/public-share";
import type { Month, ShareLink } from "@/types/models";

/**
 * Share links: creating them as a signed-in user, and resolving them as nobody.
 *
 * The two halves of this file use deliberately different doors.
 *
 *   AUTHENTICATED  ordinary RLS reads and writes on `share_links` as the
 *                  signed-in manager or PA, exactly like every other module in
 *                  `lib/data/`. No service-role client anywhere - a token is
 *                  staff data, and staff can already reach it.
 *
 *   PUBLIC         one RPC, `resolve_share_report`, which is the only thing in
 *                  the schema `anon` may execute. It validates the token, then
 *                  returns a projection of one month. There is no table read on
 *                  this path, so there is nothing for a widened policy or a
 *                  forgotten filter to leak.
 *
 * Note what the public half does NOT do: it does not calculate. It receives
 * records and hands them to the Stage 3 engine and the Stage 4 presenter, which
 * is why the shared report and the signed-in dashboard cannot disagree.
 */

// -----------------------------------------------------------------------------
// Authenticated: creating, listing and revoking
// -----------------------------------------------------------------------------

/** One row of the link list the PA manages. Never sent to a public viewer. */
export type ShareLinkSummary = {
  id: string;
  token: string;
  monthId: string;
  monthLabel: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
  lastAccessedAt: string | null;
};

type ShareLinkRow = ShareLink & {
  months: Pick<Month, "id" | "year" | "month" | "label"> | null;
};

/**
 * The active link for a month, or `null`.
 *
 * "Active" means not revoked and not past its expiry. Expiry is checked here as
 * well as in the database so a link the resolver would refuse is never offered
 * for reuse - the two agree, and this is the cheaper place to find out.
 */
export async function findActiveShareLink(
  monthId: string,
): Promise<Result<ShareLinkSummary | null>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("share_links")
    .select("*, months(id, year, month, label)")
    .eq("month_id", monthId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return err(readErrorMessage(error));
  }

  const usable = (data ?? [])
    .map(toSummary)
    .find((link) => link.isActive && !hasExpired(link));

  return ok(usable ?? null);
}

/**
 * The link for a month, reusing an active one when there is one.
 *
 * ---------------------------------------------------------------------------
 * Why reuse rather than always create
 * ---------------------------------------------------------------------------
 * The PA opens the report panel every time they post an update - several times
 * a month, and more at month end. Minting a token per click would leave dozens
 * of live URLs for September, every one of them a working public dashboard, and
 * revoking "the September link" would stop meaning anything.
 *
 * So one active link per month is the norm: the URL in the group chat on the
 * 4th is the same URL on the 25th, and it shows the 25th's figures because the
 * token names a month, not a snapshot.
 *
 * `force` is the deliberate exception - "rotate this month's link" - and it
 * revokes the old one in the same breath rather than leaving two live. A month
 * whose link was revoked simply has no active link, so the next generation
 * mints a fresh token, which is exactly the wanted behaviour.
 */
export async function ensureShareLinkForMonth(
  monthId: string,
  { force = false }: { force?: boolean } = {},
): Promise<Result<{ link: ShareLinkSummary; created: boolean }>> {
  const existing = await findActiveShareLink(monthId);

  if (!existing.ok) {
    return err(existing.error);
  }

  if (existing.data && !force) {
    return ok({ link: existing.data, created: false });
  }

  const supabase = await createSupabaseServerClient();

  if (existing.data && force) {
    const revoked = await revokeShareLink(existing.data.id);

    if (!revoked.ok) {
      return err(revoked.error);
    }
  }

  // `created_by` and `created_at` are omitted on purpose: the insert trigger
  // stamps both from `auth.uid()`, so authorship cannot be forged from here any
  // more than it can from a client.
  const { data, error } = await supabase
    .from("share_links")
    .insert({
      token: generateShareToken(),
      month_id: monthId,
      expires_at: shareLinkExpiry(SHARE_LINK_EXPIRY_DAYS),
    })
    .select("*, months(id, year, month, label)")
    .single();

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok({ link: toSummary(data as ShareLinkRow), created: true });
}

/** Every link ever created, newest first, for the management list. */
export async function listShareLinks(
  { limit = 25 }: { limit?: number } = {},
): Promise<Result<ShareLinkSummary[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("share_links")
    .select("*, months(id, year, month, label)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return err(readErrorMessage(error));
  }

  return ok((data ?? []).map(toSummary));
}

/**
 * Turns a link off, and hands back the row as it now stands.
 *
 * Revocation, never deletion: the row stays so "this token was circulated on
 * the 4th and switched off on the 19th" remains answerable, and so a revoked
 * token can never be re-minted by chance. It touches nothing but the link -
 * September's figures are entirely unaffected by September's link being
 * withdrawn.
 *
 * `is_active` and `revoked_at` are set together because the database's
 * `share_links_revocation_consistent` CHECK will not accept them apart.
 *
 * The updated row is RETURNED rather than discarded so the caller can show the
 * change without asking for the list again. `revoked_at` is the database's own
 * - the same `returning` the update already performs - so the row the PA sees
 * is the row that exists, not an optimistic guess at it.
 */
export async function revokeShareLink(
  id: string,
): Promise<Result<ShareLinkSummary>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("share_links")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("is_active", true)
    .select("*, months(id, year, month, label)");

  if (error) {
    return err(readErrorMessage(error));
  }

  // A failing RLS `USING` clause filters rows rather than raising, so an
  // unauthorised update "succeeds" having changed nothing. No rows back means
  // either that, or a link somebody else already revoked; both are honestly
  // reported as "not done" rather than as success.
  if (!data || data.length === 0) {
    return err("That link could not be revoked. It may already be inactive.");
  }

  return ok(toSummary(data[0] as ShareLinkRow));
}

function toSummary(row: ShareLinkRow): ShareLinkSummary {
  return {
    id: row.id,
    token: row.token,
    monthId: row.month_id,
    monthLabel: row.months?.label ?? "Unknown month",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    isActive: row.is_active,
    lastAccessedAt: row.last_accessed_at,
  };
}

function hasExpired(link: ShareLinkSummary): boolean {
  if (!link.expiresAt) {
    return false;
  }

  const at = new Date(link.expiresAt).getTime();

  return Number.isNaN(at) || at <= Date.now();
}

// -----------------------------------------------------------------------------
// Public: resolving a token
// -----------------------------------------------------------------------------

/**
 * A token -> the report, or `null`.
 *
 * ---------------------------------------------------------------------------
 * The public read path, end to end
 * ---------------------------------------------------------------------------
 *   1. shape-check the token          rejects a uuid, a month id, a path
 *   2. one RPC                        validates, touches the audit stamp,
 *                                     returns one month of records
 *   3. parseSharePayload              whatever the database sent -> typed
 *   4. buildShareReport               the Stage 3 engine, the Stage 4
 *                                     presenter, then the public projection
 *
 * `null` is returned for every unusable token without distinguishing between
 * them: never issued, revoked, expired, or bound to a month that has since been
 * deleted all look identical from outside. A caller learns only "not
 * available", which is the one answer that gives nothing away.
 *
 * Steps 3 and 4 are pure and live in `lib/share/resolve.ts`, so they are tested
 * against a real payload from a real Postgres rather than only against
 * fixtures. Step 4 calls the same functions the signed-in dashboard calls, on
 * the same records, so "the numbers must agree" is a property of the code
 * rather than something a test has to keep catching.
 *
 * One round trip. The RPC is a single statement over the month's own rows, so a
 * public view costs one request whatever the roster size - no query per HM, per
 * week or per KPI.
 */
export async function getPublicShareReport(
  token: string,
): Promise<Result<PublicShareViewModel | null>> {
  if (!isShareTokenShaped(token)) {
    return ok(null);
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("resolve_share_report", {
    p_token: token,
  });

  if (error) {
    // Logged server-side, never surfaced: the page says "unavailable" whatever
    // went wrong, so a database error cannot become a probing oracle.
    console.error("[share] resolve failed:", error.message);

    return err("This report is unavailable.");
  }

  const payload = parseSharePayload(data);

  if (!payload) {
    return ok(null);
  }

  const report = buildShareReport(payload);

  if (!report) {
    console.error("[share] the month could not be assembled");

    return err("This report is unavailable.");
  }

  return ok(report);
}
