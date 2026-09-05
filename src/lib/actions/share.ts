"use server";

import { revalidatePath } from "next/cache";

import { requirePaOrManager } from "@/lib/auth/session";
import { parseMonthParam } from "@/lib/calendar";
import { getDashboardData } from "@/lib/data/dashboard";
import {
  ensureShareLinkForMonth,
  listShareLinks,
  revokeShareLink,
  type ShareLinkSummary,
} from "@/lib/data/share";
import { generateWhatsAppReport } from "@/lib/reports/whatsapp";
import { failure, success, type ActionState } from "@/lib/result";
import { ROUTES, sharePath } from "@/lib/routes";
import { absoluteUrl } from "@/lib/share/origin";
import { buildDashboardViewModel } from "@/lib/view-models/dashboard";
import { buildMonthlyPerformanceViewModel } from "@/lib/view-models/monthly-performance";

/**
 * Generating and managing share links.
 *
 * ---------------------------------------------------------------------------
 * Why the report is built here and not on the dashboard render
 * ---------------------------------------------------------------------------
 * Because generating it CREATES something. The report carries a link, the link
 * needs a token, and a token is a row - so building the report as part of every
 * dashboard render would mint a public URL every time anybody glanced at
 * September. It happens when the PA asks for it, once, and reuses the month's
 * existing link when there is one.
 *
 * The figures are re-read rather than passed in from the page. That costs one
 * fetch and buys two things: the message carries what the data says at the
 * moment of copying rather than at the moment the tab was opened, and the
 * report is assembled by the same `getDashboardData -> engine -> presenter`
 * path the screen uses, with no shortcut around it.
 */

export type ShareReportPayload = {
  monthLabel: string;
  monthParam: string;
  /** Exactly what goes on the clipboard. The preview renders this same string. */
  reportText: string;
  shareUrl: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  /** True when this click minted a token rather than reusing the month's. */
  created: boolean;
  links: ShareLinkSummary[];
};

export type ShareReportState = ActionState & {
  payload: ShareReportPayload | null;
};

/**
 * What a revoke hands back: the link as it now stands, or nothing.
 *
 * A separate type from `ShareReportState` rather than a reuse of it, because
 * revoking does not build a report and must not look as though it might. It
 * carries the one row that changed - already projected through
 * `ShareLinkSummary`, so no database column reaches the client that the list
 * was not already showing - and the panel updates that row in place from it.
 */
export type ShareLinkState = ActionState & {
  link: ShareLinkSummary | null;
};

function shareFailure(message: string): ShareReportState {
  return { ...failure(message), payload: null };
}

/**
 * Builds the WhatsApp report for a month and returns it with its share link.
 *
 * `month` is the `?month=2026-09` value the dashboard is showing, parsed and
 * resolved through the same helper the page uses - so the message is about the
 * month on screen, and a tampered parameter resolves the way it would there
 * rather than reaching the database as-is.
 */
export async function generateShareReportAction(
  month: string | null,
  { rotate = false }: { rotate?: boolean } = {},
): Promise<ShareReportState> {
  await requirePaOrManager();

  const request = parseMonthParam(month);
  const data = await getDashboardData(request);

  if (!data.ok) {
    return shareFailure(data.error);
  }

  if (data.data === null) {
    return shareFailure(
      "There is no reporting month to share yet. Open one in Data Entry first.",
    );
  }

  const { selectedMonth, bundle, lastUpdatedAt } = data.data;

  const performance = buildMonthlyPerformanceViewModel(bundle);

  if (!performance) {
    return shareFailure(
      "This month could not be assembled. Reload the page and try again.",
    );
  }

  const link = await ensureShareLinkForMonth(selectedMonth.id, {
    force: rotate,
  });

  if (!link.ok) {
    return shareFailure(link.error);
  }

  const shareUrl = await absoluteUrl(sharePath(link.data.link.token));

  const dashboard = buildDashboardViewModel({
    selectedMonth,
    performance,
    lastUpdatedAt,
  });

  // One generation, one string. The preview and the clipboard are handed the
  // same value, so what the PA reads before copying is what the group receives.
  const reportText = generateWhatsAppReport(dashboard, { shareUrl });

  const links = await listShareLinks();

  return {
    ...success(
      link.data.created
        ? "A new share link was created for this month."
        : null,
    ),
    payload: {
      monthLabel: dashboard.month.label,
      monthParam: dashboard.month.param,
      reportText,
      shareUrl,
      token: link.data.link.token,
      createdAt: link.data.link.createdAt,
      expiresAt: link.data.link.expiresAt,
      created: link.data.created,
      links: links.ok ? links.data : [],
    },
  };
}

/**
 * Turns a share link off.
 *
 * Available to both roles: whoever posted the link into the group is the person
 * who needs to be able to withdraw it, and waiting for a manager is how a link
 * stays live longer than it should. It affects the link only - no month, no
 * figure and no HM record is touched.
 */
export async function revokeShareLinkAction(
  id: string,
): Promise<ShareLinkState> {
  await requirePaOrManager();

  const revoked = await revokeShareLink(id);

  if (!revoked.ok) {
    return { ...failure(revoked.error), link: null };
  }

  // The revoked token now resolves to nothing, so any page rendered from it has
  // to stop being served from cache.
  revalidatePath(ROUTES.share, "layout");

  // The revoked row goes back with the result rather than the client asking for
  // the whole list again: one write, one round trip, and the row the panel
  // draws is the row the database wrote. Re-reading the list would be a second
  // query whose only new information is already in hand.
  return { ...success("Share link revoked."), link: revoked.data };
}
