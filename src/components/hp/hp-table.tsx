import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { HpRowModel } from "@/lib/view-models/hp-listing";

type HpTableProps = {
  rows: readonly HpRowModel[];
  monthLabel: string;
};

/**
 * The month's HP rows.
 *
 * ---------------------------------------------------------------------------
 * Two layouts, because ten columns do not fit on a phone
 * ---------------------------------------------------------------------------
 * Under `md` this is a list of cards; from `md` up it is the table. Not a
 * horizontally-scrolling table at 375px: ten columns in a 375px viewport means
 * the reader scrolls sideways to find out whether the row they are looking at
 * is the HP they searched for, and loses the name doing it.
 *
 * Both layouts show the SAME ten fields - HP Name, HP Code, HM Name, HM Code,
 * W1-W4, Total Key-In, Total Net - so the phone is not a reduced version of the
 * page. Only the arrangement changes.
 *
 * Read-only, by design. HP figures come from the PA's spreadsheet through the
 * import, and an editable cell here would be a second way in that the import
 * would silently overwrite next month.
 */
export function HpTable({ rows, monthLabel }: HpTableProps) {
  return (
    <>
      {/* ---- phones ------------------------------------------------------ */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="glass-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight break-words text-slate-900">
                  {row.hpName}
                </p>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
                  {row.hpCode}
                </p>
              </div>

              <Badge tone={row.isActive ? "positive" : "muted"}>
                {row.statusLabel}
              </Badge>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              <Link
                href={row.hmHref}
                className="font-medium text-sky-700 underline-offset-2 hover:underline"
              >
                {row.hmName}
              </Link>
              <span className="mx-1.5 text-slate-300" aria-hidden>
                ·
              </span>
              <span className="font-mono tabular-nums">{row.hmCode}</span>
            </p>

            <dl className="mt-3.5 grid grid-cols-4 gap-2 border-t hairline-inner pt-3.5">
              {row.weekLabels.map((value, index) => (
                <div key={index}>
                  <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    W{index + 1}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium tabular-nums text-slate-700">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <dl className="mt-3.5 grid grid-cols-2 gap-2 border-t hairline-inner pt-3.5">
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  Total Key-In
                </dt>
                <dd className="figure-num mt-1 text-lg font-semibold leading-none text-slate-900">
                  {row.totalKeyInLabel}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  Total Net
                </dt>
                <dd className="figure-num mt-1 text-lg font-semibold leading-none text-slate-900">
                  {row.totalNetLabel}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {/* ---- tablet and up ----------------------------------------------- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            HP performance for {monthLabel}
          </caption>
          <thead>
            <tr className="border-b hairline text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">
              <th scope="col" className="py-2 pr-4 font-medium">
                HP Name
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                HP Code
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                HM
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                HM Code
              </th>
              {["W1", "W2", "W3", "W4"].map((week) => (
                <th
                  key={week}
                  scope="col"
                  className="py-2 pr-3 text-right font-medium"
                >
                  {week}
                </th>
              ))}
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Total Key-In
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Total Net
              </th>
              <th scope="col" className="py-2 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900/[0.06]">
            {rows.map((row) => (
              // A hover tint, because ten columns is a long way for an eye to
              // track across without something holding the line together.
              <tr key={row.id} className="transition-colors hover:bg-slate-900/[0.025]">
                <th
                  scope="row"
                  className="py-3 pr-4 text-left font-medium text-slate-900"
                >
                  {row.hpName}
                </th>
                <td className="py-2.5 pr-4 font-mono text-xs tabular-nums text-slate-600">
                  {row.hpCode}
                </td>
                <td className="py-2.5 pr-4">
                  <Link
                    href={row.hmHref}
                    className="text-sky-700 underline-offset-2 hover:underline"
                  >
                    {row.hmName}
                  </Link>
                </td>
                <td className="py-2.5 pr-4 font-mono text-xs tabular-nums text-slate-600">
                  {row.hmCode}
                </td>
                {row.weekLabels.map((value, index) => (
                  <td
                    key={index}
                    className="py-2.5 pr-3 text-right tabular-nums text-slate-600"
                  >
                    {value}
                  </td>
                ))}
                <td className="py-2.5 pr-4 text-right font-semibold tabular-nums text-slate-900">
                  {row.totalKeyInLabel}
                </td>
                <td className="py-2.5 pr-4 text-right font-semibold tabular-nums text-slate-900">
                  {row.totalNetLabel}
                </td>
                <td className="py-2.5">
                  <Badge tone={row.isActive ? "positive" : "muted"}>
                    {row.statusLabel}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
