/**
 * The HM screen's shape, before the figures arrive.
 *
 * Deliberately the same measurements as the real thing - the same avatar and
 * heading block, the same Net-then-target-then-achievement row, a weekly card of
 * the same height - so the page does not jump when the data lands. A spinner in
 * the middle of an empty page would reflow everything the moment it was
 * replaced.
 *
 * One slow pulse and nothing else. This is on screen for a few hundred
 * milliseconds; anything more elaborate is noise a manager sees several times a
 * day.
 */
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-slate-200/70 ${className}`} />;
}

function TileSkeleton({ height }: { height: string }) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm ${height}`}
    >
      <Block className="h-2.5 w-16" />
      <Block className="mt-3 h-8 w-24" />
      <Block className="mt-3 h-2 w-12" />
    </div>
  );
}

export function HmDetailSkeleton() {
  return (
    <div aria-busy className="space-y-4">
      <span className="sr-only" role="status">
        Loading HM performance
      </span>

      <div className="space-y-4 border-b border-slate-200 pb-4">
        <Block className="h-5 w-44" />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="size-16 animate-pulse rounded-full bg-slate-200/70" />
            <div>
              <Block className="h-7 w-48" />
              <Block className="mt-2 h-3 w-32" />
              <Block className="mt-3 h-3.5 w-36" />
              <Block className="mt-2 h-2.5 w-44" />
            </div>
          </div>
          <Block className="h-10 w-64" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TileSkeleton height="h-[132px]" />
        <TileSkeleton height="h-[132px]" />
        <TileSkeleton height="h-[132px]" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
        <Block className="h-2.5 w-32" />
        <Block className="mt-3 h-2 w-full rounded-full" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TileSkeleton height="h-[104px]" />
        <TileSkeleton height="h-[104px]" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TileSkeleton height="h-[104px]" />
        <TileSkeleton height="h-[104px]" />
        <TileSkeleton height="h-[104px]" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <Block className="h-2.5 w-28" />
          <div className="mt-4 space-y-3">
            {[80, 65, 45, 70, 30].map((width, index) => (
              <div key={index} className="flex items-center gap-3">
                <Block className="h-3 w-8" />
                <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                  <div
                    className="h-full animate-pulse rounded-full bg-slate-200/70"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <Block className="h-3 w-8" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <Block className="h-2.5 w-24" />
          <Block className="mt-4 h-3 w-full" />
          <Block className="mt-2 h-2 w-full rounded-full" />
          <Block className="mt-5 h-3 w-full" />
          <Block className="mt-2 h-2 w-full rounded-full" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1].map((key) => (
          <div
            key={key}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <Block className="h-2.5 w-28" />
            <Block className="mt-4 h-7 w-24" />
            <Block className="mt-3 h-2.5 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}
