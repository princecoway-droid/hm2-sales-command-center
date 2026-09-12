import { notFound } from "next/navigation";

import { HmComparison } from "@/components/hm-detail/hm-comparison";
import { HmDetailHeader } from "@/components/hm-detail/hm-detail-header";
import { HmNoDataState } from "@/components/hm-detail/hm-detail-states";
import { HmPrimaryPerformance } from "@/components/hm-detail/hm-primary-performance";
import { HmQtd } from "@/components/hm-detail/hm-qtd";
import { HmSalesMix } from "@/components/hm-detail/hm-sales-mix";
import { HmSecondaryKpis } from "@/components/hm-detail/hm-secondary-kpis";
import { HmWeeklyPerformance } from "@/components/hm-detail/hm-weekly-performance";
import { APP_NAME } from "@/lib/app";
import { getPublicShareHmReport } from "@/lib/data/share";
import { shareHmHpPath, sharePath } from "@/lib/routes";

/**
 * One HM's month, read-only, at /share/<token>/hm/<hmId>.
 *
 * ---------------------------------------------------------------------------
 * The second unauthenticated page, and it is the first one's inside
 * ---------------------------------------------------------------------------
 * It takes TWO inputs, both from the path: the token, and the HM. Like its
 * parent it reads no search parameters at all - not `?month=`, not anything -
 * because the month was decided when the link was created and lives on the
 * `share_links` row. `/share/<token>/hm/<id>?month=2025-01` renders exactly
 * what `/share/<token>/hm/<id>` renders.
 *
 * The token is still the whole of the authorization. `getPublicShareHmReport`
 * puts it through the same gate the group report goes through and additionally
 * refuses an HM the token's month is not about, so this page can only ever open
 * a card that report already showed. Revoke the link and both pages stop in the
 * same instant.
 *
 * Every component below is the SIGNED-IN HM screen's own, rendered from a model
 * built by the same engine and the same presenter - see `buildShareHmDetail`.
 * There is no second calculation anywhere on this path, which is what makes
 * "the figures here equal the figures the manager sees" a property of the code.
 *
 * What is deliberately absent, and it is the same list as the parent's: no
 * month switcher, no navigation, no sign-out, no edit, no Data Entry link, and
 * no manager or PA named anywhere. Two links leave this page and both stay
 * inside the token: back to the report it was opened from, and forward into
 * this HM's own HP list.
 *
 * `force-dynamic` for the parent's reason: a report is live and a token is
 * revocable, and a cached page would keep serving a withdrawn link's figures.
 */
export const dynamic = "force-dynamic";

export default async function ShareHmPage(
  props: PageProps<"/share/[token]/hm/[hmId]">,
) {
  const { token, hmId } = await props.params;

  const backHref = sharePath(token);

  const result = await getPublicShareHmReport(token, hmId, {
    backHref,
    // Active HP is a COUNT, and "18" invites "which 18". The figure links to
    // the HP list UNDER THIS TOKEN - never to `/hp`, which is behind a login
    // this reader does not have. Built here, where the token is, so no public
    // model can be handed a route into the private app.
    hpListingHref: shareHmHpPath(token, hmId),
  });

  // A failed read, an unusable token and an HM who is not on this month's
  // report all look identical from out here on purpose. The segment's own
  // `not-found.tsx` answers all three with "this report is unavailable", and
  // only the server log knows which it was.
  if (!result.ok || result.data === null) {
    notFound();
  }

  const detail = result.data;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-4">
        <HmDetailHeader
          hm={detail.hm}
          month={detail.month}
          backHref={detail.backHref}
          // Never "Back to Dashboard": the reader has no dashboard.
          backLabel="Back to report"
          updatedLabel={detail.updatedLabel}
          // No `controls`, so no month switcher. The token names the month.
        />

        {detail.emptyMessage ? (
          <HmNoDataState
            message={detail.emptyMessage}
            monthLabel={detail.month.label}
            // Read-only, and the reader has no session: there is no Data Entry
            // to send them to, so the banner offers nothing to click.
            dataEntryHref={null}
          />
        ) : null}

        {/* The same sections in the same order as the private screen, so the
            two are one page with one audience removed rather than two designs
            that have to be kept in step. */}
        <HmPrimaryPerformance detail={detail} />

        <HmSecondaryKpis metrics={detail.secondary} />

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HmWeeklyPerformance
              weekly={detail.weekly}
              monthLabel={detail.month.label}
            />
          </div>

          <HmSalesMix salesMix={detail.salesMix} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <HmComparison
            net={detail.previousMonthNet}
            recruitment={detail.previousMonthRecruitment}
          />

          <HmQtd qtd={detail.qtd} />
        </div>
      </div>

      <ShareHmFooter updatedLabel={detail.updatedLabel} />
    </main>
  );
}

/**
 * The report's own footer, restated.
 *
 * Same words as the group page's: the system that produced the figures, that
 * they are read-only, and when they were last written. No manager name, no PA
 * name, no account, no version - who keyed them in is internal.
 */
function ShareHmFooter({ updatedLabel }: { updatedLabel: string | null }) {
  return (
    <footer className="mt-8 border-t border-slate-200 pt-4 text-center">
      <p className="text-xs font-medium text-slate-500">{APP_NAME}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">Read-only report</p>
      {updatedLabel ? (
        <p className="mt-0.5 text-[11px] text-slate-400">
          Updated {updatedLabel} (MYT)
        </p>
      ) : null}
    </footer>
  );
}
