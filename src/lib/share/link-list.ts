import type { ShareLinkSummary } from "@/lib/data/share";

/**
 * The share-link list, as a model rather than as component state.
 *
 * Same reasoning as `lib/data-entry/grid-model.ts`: what the panel does to its
 * list after a write is ordinary logic that happens to live in a browser, and
 * putting it in a pure module means "revoke updates the row, and the counts
 * follow" is proved in a plain Node test rather than argued for in a comment
 * next to a `useState`.
 *
 * Nothing here fetches, and nothing here invents a row. Every value the list
 * ends up holding came from the server: a create replaces the list wholesale
 * with the one the action returned, and a revoke folds in the row the update
 * returned. There is no optimistic path, so there is no state to reconcile
 * afterwards and no window where the table disagrees with the database.
 */

export type ShareLinkCounts = {
  total: number;
  active: number;
  revoked: number;
};

/**
 * Folds a revoked row back into the list.
 *
 * Replaces by `id`, in place, keeping the order the server sent - a revoked
 * link stays where it was in the list rather than jumping, because the list is
 * ordered by creation and revoking one did not create anything.
 *
 * A row the list has never heard of is IGNORED rather than appended. The only
 * way to revoke a link is to press the button on its own row, so an unknown id
 * means the list has moved on; appending it would put a row on screen that the
 * next refresh would not contain.
 */
export function applyRevokedLink(
  links: readonly ShareLinkSummary[],
  revoked: ShareLinkSummary,
): ShareLinkSummary[] {
  return links.map((link) => (link.id === revoked.id ? revoked : link));
}

/** Active, revoked and total, counted from the rows themselves. */
export function countShareLinks(
  links: readonly ShareLinkSummary[],
): ShareLinkCounts {
  const active = links.filter((link) => link.isActive).length;

  return { total: links.length, active, revoked: links.length - active };
}

/**
 * True when the list says this token is no longer live.
 *
 * A token the list does not contain is NOT reported as revoked: the list is
 * capped at the most recent links, and absence from it is not evidence. The
 * safe direction here is the opposite of the resolver's - this only decides
 * whether the panel offers a URL to copy, and the database decides whether that
 * URL opens anything.
 */
export function isTokenRevoked(
  links: readonly ShareLinkSummary[],
  token: string,
): boolean {
  return links.some((link) => link.token === token && !link.isActive);
}
