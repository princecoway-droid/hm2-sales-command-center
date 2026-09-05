/**
 * The dashboard's shape, before the figures arrive.
 *
 * Deliberately the same measurements as the real thing - the same eight KPI
 * cards in the same two rows, a chart block of the same height, six HM cards
 * on the same grid - so the page does not jump when the data lands. A spinner
 * in the middle of an empty page would reflow everything the moment it was
 * replaced.
 *
 * One slow pulse and nothing else. This is on screen for a few hundred
 * milliseconds; anything more elaborate is noise a manager sees several times a
 * day.
 */
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-slate-200/70 ${className}`} />;
}

function CardSkeleton({ height }: { height: string }) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${height}`}
    >
      <Block className="h-2.5 w-16" />
      <Block className="mt-3 h-7 w-20" />
      <Block className="mt-3 h-2 w-10" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div aria-busy className="space-y-4">
      <span className="sr-only" role="status">
        Loading dashboard
      </span>

      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Block className="h-2.5 w-40" />
          <Block className="mt-2 h-8 w-56" />
          <Block className="mt-2 h-2.5 w-44" />
        </div>
        <Block className="h-10 w-64" />
      </div>

      <Block className="h-11 w-full rounded-lg" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <CardSkeleton key={key} height="h-[112px]" />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <CardSkeleton key={key} height="h-[104px]" />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <Block className="h-2.5 w-28" />
          <div className="mt-4 flex h-36 items-end gap-3">
            {[70, 90, 80, 55, 35].map((height, index) => (
              <div key={index} className="flex h-full flex-1 items-end">
                <div
                  className="w-full animate-pulse rounded-t bg-slate-200/70"
                  style={{ height: `${height}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <Block className="h-2.5 w-24" />
          <Block className="mt-4 h-7 w-24" />
          <Block className="mt-6 h-2.5 w-28" />
          <Block className="mt-3 h-6 w-20" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <div
            key={key}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="size-16 animate-pulse rounded-full bg-slate-200/70" />
              <div className="flex-1">
                <Block className="h-3 w-24" />
                <Block className="mt-2 h-2.5 w-20" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((cell) => (
                <div key={cell}>
                  <Block className="h-2 w-14" />
                  <Block className="mt-2 h-5 w-10" />
                </div>
              ))}
            </div>
            <Block className="mt-4 h-2 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
