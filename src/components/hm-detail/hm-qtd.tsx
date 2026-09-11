import type { QtdModel } from "@/lib/view-models/dashboard";

type HmQtdProps = {
  qtd: QtdModel;
};

/**
 * The quarter so far, for this HM.
 *
 * Quarter to date is counted in REPORTING MONTHS, not elapsed days - a Coway
 * sales week routinely starts in the previous calendar month, so a day-based
 * cut would slice a week in half and report a total nobody can reconcile
 * against eTrust.
 *
 * A month of the quarter with no record contributes nothing and is NAMED, never
 * quietly summed over: "220 so far, no data yet for July" is the honest reading,
 * and it is a different statement from a complete quarter of 220.
 */
export function HmQtd({ qtd }: HmQtdProps) {
  return (
    <section
      aria-labelledby="hm-qtd"
      className="glass-panel flex flex-col gap-4 p-4 sm:p-5"
    >
      <h2 id="hm-qtd" className="section-label">
        {qtd.quarterLabel} to date
      </h2>

      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-slate-500">QTD Net</dt>
          <dd className="figure-num text-2xl font-semibold leading-tight text-slate-900">
            {qtd.netLabel}
            <span className="ml-1 text-xs font-normal text-slate-400">
              units
            </span>
          </dd>
        </div>

        <div>
          <dt className="text-xs text-slate-500">QTD Recruitment</dt>
          <dd className="figure-num text-2xl font-semibold leading-tight text-slate-900">
            {qtd.recruitmentLabel}
          </dd>
        </div>
      </dl>

      <p className="mt-auto text-xs text-slate-500">
        {qtd.monthsLabel}
        {qtd.incompleteMessage ? (
          <span className="text-amber-700"> · {qtd.incompleteMessage}</span>
        ) : null}
      </p>
    </section>
  );
}
