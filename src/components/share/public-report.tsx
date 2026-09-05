import { ShareHmCard } from "@/components/share/share-hm-card";
import { ShareWeekly } from "@/components/share/share-weekly";
import {
  STATUS_DOT_CLASSES,
  STATUS_TEXT_CLASSES,
} from "@/components/ui/status-styles";
import { APP_NAME } from "@/lib/app";
import { cn } from "@/lib/utils";
import type {
  PublicKpi,
  PublicShareViewModel,
} from "@/lib/view-models/public-share";

/**
 * The read-only month report.
 *
 * ---------------------------------------------------------------------------
 * What is not here, and why that is the design
 * ---------------------------------------------------------------------------
 * No navigation. No sign-out. No month selector, no previous or next month, no
 * refresh, no edit, and no manager or PA named anywhere. This page is opened
 * from a WhatsApp message by people who have no account and are not supposed to
 * get one, so it shows one month's group report and offers no way to ask for
 * anything else.
 *
 * The absence of a month control in particular is load-bearing: without it the
 * link is a report, with it the link is a database browser. The token decides
 * the month, once, when it is created.
 *
 * Every figure on this page came off the same engine and the same presenter as
 * the signed-in dashboard - see `buildPublicShareViewModel`. Nothing here
 * formats a number or decides a status.
 *
 * Laid out for 375px first: one column of stacked cards, two columns of KPIs,
 * and nothing that needs sideways scrolling. It grows to a comfortable reading
 * width and stops - a report is not improved by being 1400px wide.
 */
export function PublicReport({ report }: { report: PublicShareViewModel }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <ReportHeader report={report} />

      {!report.hasAnyData ? (
        <p className="mt-6 rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No figures have been recorded for {report.monthLabel} yet.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          <GroupPerformance report={report} />
          <ShareWeekly weekly={report.weekly} monthLabel={report.monthLabel} />
          <HmPerformance report={report} />
        </div>
      )}

      <ReportFooter updatedLabel={report.updatedLabel} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------

/**
 * Who, when, and how complete - before a single figure.
 *
 * The completeness line sits in the header rather than further down for the
 * same reason it opens the WhatsApp message: it changes how everything below
 * should be read, and somebody scrolling a phone in a group chat may not reach
 * the bottom of the page.
 */
function ReportHeader({ report }: { report: PublicShareViewModel }) {
  return (
    <header className="border-b border-slate-200 pb-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {report.title}
      </p>

      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        {report.monthLabel}
        <span className="ml-2 align-middle text-sm font-medium text-slate-400">
          {report.quarterLabel}
        </span>
      </h1>

      <p className="mt-1 text-xs text-slate-500">
        {report.updatedLabel ? (
          <>Updated {report.updatedLabel} (MYT)</>
        ) : (
          <>No figures recorded for this month yet</>
        )}
      </p>

      <div
        role="status"
        className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
      >
        <span className="flex items-center gap-2 font-medium">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              STATUS_DOT_CLASSES[report.completeness.status],
            )}
          />
          <span className={STATUS_TEXT_CLASSES[report.completeness.status]}>
            {report.completeness.headline}
          </span>
        </span>

        {report.completeness.detail ? (
          <span className="text-xs text-slate-500">
            {report.completeness.detail}
          </span>
        ) : null}
      </div>
    </header>
  );
}

// -----------------------------------------------------------------------------
// Group
// -----------------------------------------------------------------------------

function GroupPerformance({ report }: { report: PublicShareViewModel }) {
  const primary = report.kpis.slice(0, 4);
  const secondary = report.kpis.slice(4);

  return (
    <section aria-labelledby="share-group" className="space-y-3">
      <h2 id="share-group" className="text-sm font-semibold text-slate-900">
        Group performance
      </h2>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        {primary.map((tile) => (
          <ShareKpi key={tile.key} tile={tile} emphasis />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {secondary.map((tile) => (
          <ShareKpi key={tile.key} tile={tile} />
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Net against target
        </p>

        {report.target.hasTarget ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="tabular-nums text-slate-600">
                <span className="font-semibold text-slate-900">
                  {report.target.netLabel}
                </span>{" "}
                / {report.target.targetLabel} units
              </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {report.target.achievementLabel}
              </span>
            </div>

            <div
              className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                report.target.progressPct === null
                  ? undefined
                  : Math.round(report.target.progressPct)
              }
              aria-valuetext={`${report.target.achievementLabel} of target`}
              aria-label={`Group net against target, ${report.monthLabel}`}
            >
              <div
                className="h-2 rounded-full bg-sky-600"
                style={{ width: `${report.target.progressPct ?? 0}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">No target set</p>
        )}
      </div>
    </section>
  );
}

function ShareKpi({ tile, emphasis }: { tile: PublicKpi; emphasis?: boolean }) {
  const subLabel = tile.unit ?? tile.note;

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white px-3.5 py-3 shadow-sm sm:px-4">
      <p className="truncate text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {tile.label}
      </p>

      <p
        className={cn(
          "mt-1.5 font-semibold tabular-nums leading-none text-slate-900",
          emphasis ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl",
        )}
      >
        {tile.value}
      </p>

      {/* Always rendered, blank when there is nothing to say, so a row of
          cards stays the same height whatever has been entered. */}
      <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
        {subLabel ?? " "}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// HMs
// -----------------------------------------------------------------------------

function HmPerformance({ report }: { report: PublicShareViewModel }) {
  return (
    <section aria-labelledby="share-hms" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="share-hms" className="text-sm font-semibold text-slate-900">
          HM performance
        </h2>
        <p className="text-xs text-slate-500">Ranked by net units</p>
      </div>

      {report.hms.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          No HM records for {report.monthLabel}.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {report.hms.map((hm) => (
            <li key={hm.key}>
              <ShareHmCard hm={hm} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Footer
// -----------------------------------------------------------------------------

/**
 * Where this came from, and nothing else.
 *
 * No manager name, no PA name, no account, no version, no database detail. The
 * page identifies the system that produced the report and states that it is
 * read-only; who keyed the figures in is internal.
 */
function ReportFooter({ updatedLabel }: { updatedLabel: string | null }) {
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
