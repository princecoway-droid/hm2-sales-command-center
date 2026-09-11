import { Badge } from "@/components/ui/badge";
import type { ShareHpListViewModel } from "@/lib/share/resolve-hp";

type ShareHpListProps = {
  rows: ShareHpListViewModel["rows"];
  monthLabel: string;
};

/**
 * One HM's HPs, on the shared report.
 *
 * ---------------------------------------------------------------------------
 * Cards on a phone, a table when there is room
 * ---------------------------------------------------------------------------
 * This page is read in a WhatsApp group, which means it is read on a phone,
 * which means the ten-column table the manager gets is the wrong shape: at
 * 375px the reader would be scrolling sideways to find out whether the row in
 * front of them is the HP they were looking for, and would lose the name doing
 * it.
 *
 * So under `md` each HP is a card - name and code, then the four weeks, then
 * the two totals - and from `md` up it becomes the table. Both carry the SAME
 * fields; only the arrangement changes, so the phone is not a reduced version
 * of the page.
 *
 * Active first, decided in SQL and not re-sorted here: the reader arrived by
 * tapping "Active HP 18", and the eighteen they came for are at the top.
 *
 * Read-only, like everything else behind a token. There is no filter, no
 * search, no sort control and no month - this is one HM's month as it stands,
 * and a control that could change it would make the link a database browser.
 */
export function ShareHpList({ rows, monthLabel }: ShareHpListProps) {
  return (
    <>
      {/* ---- phones ------------------------------------------------------ */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map((row) => (
          <li
            key={row.key}
            className="glass-card p-3.5"
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
                <dd className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900">
                  {row.totalKeyInLabel}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  Total Net
                </dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900">
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
              <tr key={row.key}>
                <th
                  scope="row"
                  className="py-2.5 pr-4 text-left font-medium text-slate-900"
                >
                  {row.hpName}
                </th>
                <td className="py-2.5 pr-4 font-mono text-xs tabular-nums text-slate-600">
                  {row.hpCode}
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
