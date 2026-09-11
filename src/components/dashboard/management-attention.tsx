import Link from "next/link";

import { KPI_STATUS_DOT_CLASSES } from "@/components/ui/status-styles";
import { cn } from "@/lib/utils";
import type { ManagementAttentionModel } from "@/lib/view-models/dashboard";

type ManagementAttentionProps = {
  attention: ManagementAttentionModel;
  monthLabel: string;
  /** "W2" - the week the Key-In bands were taken from, when there is one. */
  currentWeekLabel: string | null;
};

/**
 * Who to look at first, and which KPI.
 *
 * ---------------------------------------------------------------------------
 * What this section says, and what it refuses to say
 * ---------------------------------------------------------------------------
 * It names HMs with at least one KPI in the NEEDS ATTENTION band, and the names
 * of those KPIs. That is the whole of it. There is no advice here, no
 * explanation, no coaching line and no ranking of people - every word on screen
 * is either a name the PA typed or a threshold the business set, so a manager
 * reading it is reading their own rules rather than an opinion about their
 * team.
 *
 * WATCH does not appear. A list holding both bands would name most of the team
 * most months, which is the fastest way to make a list stop being read.
 *
 * An empty list is the good case and reads like one - a plain statement that
 * nothing is below the threshold, not a congratulation and not an empty box
 * that looks like something failed to load.
 *
 * Server-rendered, no JavaScript: it is a list of links.
 */
export function ManagementAttention({
  attention,
  monthLabel,
  currentWeekLabel,
}: ManagementAttentionProps) {
  return (
    <section
      aria-labelledby="management-attention"
      className={cn(
        "glass-panel overflow-hidden",
        // Marked in rose only when there is something in it, and marked with a
        // hairline rather than a fill: this is an executive list of names, not
        // a warning box. A permanently red-edged panel stops meaning anything
        // by the second week.
        attention.hasItems && "border-rose-500/25",
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b hairline px-4 py-3.5 sm:px-5">
        <h2 id="management-attention" className="section-label">
          Management attention
        </h2>

        <p className="text-xs text-slate-500">
          {attention.headline}
          {/* The Key-In band is a statement about a particular week, so the
              week is named. "On track" with no "as at" is not a fact. */}
          {currentWeekLabel ? (
            <>
              {" · "}
              <span className="text-slate-400">
                Key-In as at {currentWeekLabel}
              </span>
            </>
          ) : null}
        </p>
      </header>

      {!attention.hasItems ? (
        <p className="px-4 py-7 text-center text-sm text-slate-500">
          {attention.emptyMessage}
        </p>
      ) : (
        <ul className="divide-y divide-slate-900/[0.06]">
          {attention.items.map((item) => (
            <li key={item.hmId}>
              <Link
                href={item.href}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 transition-colors hover:bg-rose-500/[0.05] focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-600 sm:px-5"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    KPI_STATUS_DOT_CLASSES.needs_attention,
                  )}
                />

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-tight break-words text-slate-900">
                    {item.name}
                  </span>
                  <span className="block text-xs tabular-nums text-slate-500">
                    <span className="sr-only">HM Code </span>
                    {item.hmCode}
                  </span>
                </span>

                {/* The KPI names carry the meaning, so they are text rather
                    than icons, and they wrap onto their own line at 375px
                    instead of being truncated to "Recrui…". */}
                <span className="w-full text-xs font-medium text-rose-700 sm:w-auto sm:text-right">
                  {item.kpiLabels.join(" · ")}
                </span>

                <span className="sr-only">
                  {`${item.attentionCount} KPI${item.attentionCount === 1 ? "" : "s"} needing attention in ${monthLabel} - open performance detail`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
