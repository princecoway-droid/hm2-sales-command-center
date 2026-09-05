import { notFound } from "next/navigation";

import { PublicReport } from "@/components/share/public-report";
import { getPublicShareReport } from "@/lib/data/share";

/**
 * The read-only month report, at /share/<token>.
 *
 * ---------------------------------------------------------------------------
 * The only unauthenticated page in the application that shows data
 * ---------------------------------------------------------------------------
 * It takes ONE input: the token in the path. It reads no search parameters at
 * all - not `?month=`, not anything - so there is no parameter to tamper with:
 * `/share/<token>?month=2025-01` renders exactly what `/share/<token>` renders,
 * because the month was decided when the link was created and lives on the
 * `share_links` row.
 *
 * `getPublicShareReport` validates the token, resolves it through the one
 * function `anon` may execute, and runs the result through the SAME Stage 3
 * engine and Stage 4 presenter the signed-in dashboard uses. This file
 * therefore contains no formula, no query and no authorization logic of its
 * own - the token either resolves to a report or it does not.
 *
 * `force-dynamic` because a report is live and a token is revocable. Cached,
 * this page would keep serving a withdrawn link's figures from the edge, and
 * "revoke" would mean "revoke eventually" - which is not what the word means to
 * whoever just clicked it.
 */
export const dynamic = "force-dynamic";

export default async function SharePage(props: PageProps<"/share/[token]">) {
  const { token } = await props.params;

  const result = await getPublicShareReport(token);

  // A failed read and an unusable token look identical from out here on
  // purpose: the visitor is told the report is unavailable either way, and only
  // the server log knows which it was.
  if (!result.ok || result.data === null) {
    notFound();
  }

  return (
    <main>
      <PublicReport report={result.data} />
    </main>
  );
}
