import Link from "next/link";

import type { HpPaginationModel } from "@/lib/view-models/hp-listing";

type HpPaginationProps = {
  pagination: HpPaginationModel;
};

/**
 * Previous, next, and where you are.
 *
 * Real links rather than buttons, so the page is bookmarkable, opens in a new
 * tab, and works before any JavaScript has loaded. A missing href renders as a
 * disabled span rather than a dead link - there is nothing to announce as
 * clickable when there is no page to go to.
 *
 * The range is always stated ("Showing 51-100 of 148"), because "page 2" alone
 * does not tell a PA whether the row they are looking for is behind them or
 * ahead.
 */
export function HpPagination({ pagination }: HpPaginationProps) {
  const linkClasses =
    "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-sky-700 ring-1 ring-inset ring-slate-300 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";
  const disabledClasses =
    "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-300 ring-1 ring-inset ring-slate-200";

  return (
    <nav
      aria-label="HP list pages"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3"
    >
      <p className="text-xs text-slate-500">{pagination.rangeLabel}</p>

      {pagination.pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            Page {pagination.page} of {pagination.pageCount}
          </span>

          {pagination.previousHref ? (
            <Link href={pagination.previousHref} className={linkClasses}>
              ← Previous
            </Link>
          ) : (
            <span className={disabledClasses}>← Previous</span>
          )}

          {pagination.nextHref ? (
            <Link href={pagination.nextHref} className={linkClasses}>
              Next →
            </Link>
          ) : (
            <span className={disabledClasses}>Next →</span>
          )}
        </div>
      ) : null}
    </nav>
  );
}
