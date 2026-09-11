import Link from "next/link";
import { notFound } from "next/navigation";

import { HmAvatar } from "@/components/hm/hm-avatar";
import { ShareHpList } from "@/components/share/share-hp-list";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { APP_NAME } from "@/lib/app";
import { getPublicShareHmHpList } from "@/lib/data/share";
import { shareHmPath } from "@/lib/routes";

/**
 * One HM's HPs, read-only, at /share/<token>/hm/<hmId>/hp.
 *
 * ---------------------------------------------------------------------------
 * The third unauthenticated page, and the reason it exists
 * ---------------------------------------------------------------------------
 * The shared report showed an HM "Active HP 18" and gave them nowhere to go.
 * The question a number like that provokes is "which 18", and the HM is the one
 * person who genuinely needs the answer - they are the manager of those HPs.
 *
 * Three inputs, all from the path: the token, the HM, and nothing else. Like
 * both pages above it, this reads NO search parameters - not `?month=`, not a
 * filter, not a page number. The month was decided when the link was created,
 * and the whole month's HPs are shown with the active ones first, so there is
 * nothing to ask for and no control that could turn the link into a query
 * interface.
 *
 * The token remains the whole of the authorization. `resolve_share_hm_hp` puts
 * it through the same gate the other two go through and additionally refuses an
 * HM the token's month is not about, so this page can only be reached from a
 * card the report already showed. Revoke the link and all three stop in the
 * same instant.
 *
 * What is deliberately absent: no HM Code - an internal mapping key the reader
 * does not need to recognise their own team - no navigation, no sign-out, no
 * edit, and no route into the private application. The one link goes back to
 * the HM view it was opened from.
 *
 * `force-dynamic` for the same reason as its parents: a report is live and a
 * token is revocable, and a cached page would keep serving a withdrawn link's
 * figures.
 */
export const dynamic = "force-dynamic";

export default async function ShareHmHpPage(
  props: PageProps<"/share/[token]/hm/[hmId]/hp">,
) {
  const { token, hmId } = await props.params;

  const backHref = shareHmPath(token, hmId);

  const result = await getPublicShareHmHpList(token, hmId, { backHref });

  // A failed read, an unusable token and an HM who is not on this month's
  // report all look identical from out here on purpose. The segment's own
  // `not-found.tsx` answers all three with "this report is unavailable", and
  // only the server log knows which it was.
  if (!result.ok || result.data === null) {
    notFound();
  }

  const list = result.data;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-4">
        <header className="space-y-4 border-b border-slate-200 pb-4">
          {/* Back first, above everything: on a phone it is the control most
              likely to be wanted and the hardest to reach if it is tucked
              beside a title. */}
          <Link
            href={list.backHref}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <span aria-hidden>←</span>
            Back to {list.hm.name}
          </Link>

          <div className="flex items-start gap-3 sm:gap-4">
            <HmAvatar
              name={list.hm.name}
              photoUrl={list.hm.photoUrl}
              size="lg"
            />

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="text-2xl font-semibold leading-tight tracking-tight break-words text-slate-900 sm:text-3xl">
                  {list.hm.name}
                </h1>

                {!list.hm.isActive ? <Badge tone="muted">Inactive</Badge> : null}
              </div>

              <p className="mt-1 text-sm break-words text-slate-500">
                {list.hm.office}
              </p>

              <p className="mt-2 text-sm font-medium text-slate-900">
                {list.monthLabel}
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {list.quarterLabel}
                </span>
              </p>

              {/* The sentence the page is about, stated rather than left to be
                  counted off the rows: "18 of 24 HP active this month". */}
              <p className="mt-1 text-sm text-slate-600">{list.headline}</p>

              <p className="mt-1 text-xs text-slate-500">
                {list.updatedLabel ? (
                  <>Updated {list.updatedLabel} (MYT)</>
                ) : (
                  <>No HP figures recorded for this month yet</>
                )}
              </p>
            </div>
          </div>
        </header>

        {list.emptyMessage ? (
          <Alert tone="info" title="Nothing to show yet">
            <p>{list.emptyMessage}</p>
          </Alert>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              An HP is <span className="font-medium text-slate-700">Active</span>{" "}
              when their Total Key-In for the month is at least 1.
            </p>

            <ShareHpList rows={list.rows} monthLabel={list.monthLabel} />

            {list.truncatedMessage ? (
              <p className="text-xs text-slate-500">{list.truncatedMessage}</p>
            ) : null}
          </>
        )}
      </div>

      <ShareHpFooter updatedLabel={list.updatedLabel} />
    </main>
  );
}

/**
 * The report's own footer, restated.
 *
 * Same words as both pages above: the system that produced the figures, that
 * they are read-only, and when they were last written. No manager name, no PA
 * name, no account - who imported them is internal.
 */
function ShareHpFooter({ updatedLabel }: { updatedLabel: string | null }) {
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
