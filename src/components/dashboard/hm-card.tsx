import Link from "next/link";

import { TargetProgress } from "@/components/dashboard/target-progress";
import { HmAvatar } from "@/components/hm/hm-avatar";
import { Badge } from "@/components/ui/badge";
import { KpiStatusBadge } from "@/components/ui/kpi-status";
import { cn } from "@/lib/utils";
import type { HmCardModel, KpiStatusModel } from "@/lib/view-models/dashboard";

type HmCardProps = {
  hm: HmCardModel;
};

/**
 * One HM's month.
 *
 * Headline figures only: Net large, Key-In beside it, Recruitment and Active HP
 * under them, and the target as a quiet supporting line. QTD, the Extrade mix,
 * SHI and the weekly breakdown all belong on the HM detail screen - putting
 * them here would make twelve cards unreadable and answer a question nobody
 * asks of a dashboard.
 *
 * The whole card opens that HM's own screen, on the month currently being
 * looked at. The primary link is on the NAME, stretched over the card by a
 * positioned pseudo-element, rather than a wrapper `<a>` around the figures.
 * That keeps the accessible name short and meaningful ("Alisha, Amcorp Mall")
 * instead of a screen reader announcing a link made of eight numbers, and it
 * leaves the text inside selectable.
 *
 * The Active HP figure is the one exception: it is a second, smaller link, to
 * that HM's HP list for this month. It sits above the stretched overlay with
 * `relative z-10`, which is the whole of what makes it clickable - without it
 * the overlay would swallow the click and open the HM screen instead.
 *
 * Fixed structure keeps a grid of them aligned: every card has the same rows,
 * whether or not the figures behind them have been entered.
 */
export function HmCard({ hm }: HmCardProps) {
  return (
    <article
      aria-label={`${hm.name}, ${hm.office}`}
      className="group glass-card glass-interactive relative flex h-full flex-col p-4 focus-within:ring-2 focus-within:ring-sky-500/35 sm:p-5"
    >
      <header className="flex items-start gap-3">
        {/* The existing avatar, so a missing photo falls back to initials at
            exactly the same footprint and the grid never reflows as photos
            arrive. Its `alt` is empty by design: the name is right beside it,
            and repeating it would have a screen reader say it twice. */}
        <HmAvatar name={hm.name} photoUrl={hm.photoUrl} size="lg" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* Wraps rather than truncates. A card is an HM's identity, and
                "Sample HM…" with the distinguishing part cut off is worse than
                a name on two lines. */}
            <h3 className="text-[0.9375rem] font-semibold leading-snug tracking-tight break-words text-slate-900">
              {/* `after:absolute inset-0` turns the card into the hit area
                  without nesting the figures inside the anchor. Anything else
                  in the card that has to stay clickable - the Active HP figure
                  below - lifts itself above this overlay with `relative z-10`. */}
              <Link
                href={hm.href}
                className="outline-none after:absolute after:inset-0 after:rounded-card group-hover:text-sky-900"
              >
                {hm.name}
                <span className="sr-only">
                  {" "}
                  - open performance detail
                </span>
              </Link>
            </h3>
            {!hm.isActive ? <Badge tone="muted">Inactive</Badge> : null}
          </div>
          {/* The HM Code is a business identifier, not decoration: it is the
              key the HP import matches on, so a PA checking a mapping has to be
              able to read it here. Set below the name and in a lighter weight -
              clearly secondary, never hidden. */}
          <p className="text-xs break-words text-slate-500">
            {hm.office}
            <span className="mx-1.5 text-slate-300" aria-hidden>
              ·
            </span>
            <span className="font-medium tabular-nums text-slate-600">
              <span className="sr-only">HM Code </span>
              {hm.hmCode}
            </span>
          </p>
        </div>

        <span
          className="shrink-0 rounded-full bg-slate-900/[0.05] px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 ring-1 ring-inset ring-slate-900/[0.06]"
          title="Rank by net units"
        >
          #{hm.rank}
        </span>
      </header>

      {/* The four KPIs the business set thresholds for, each with its own band
          under it. Four separate answers, deliberately - "Key-In fine,
          recruitment red" is something a manager can act on this afternoon,
          where a single combined score for the card would say only that
          something, somewhere, is off. */}
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
        <Figure
          label="Net"
          value={hm.netLabel}
          emphasis
          kpiStatus={hm.statuses.net}
          showNote
        />
        {/* The figure is the month's Key-In so far; the band under it is the
            CURRENT week against the monthly target, and its note says so - "W2:
            27 of 100 target · 27.0%". Without that line the badge would look
            like it described the number above it. */}
        <Figure
          label="Key-In"
          value={hm.keyInLabel}
          kpiStatus={hm.statuses.keyIn}
          showNote
        />

        <Figure
          label="Recruitment"
          value={hm.recruitmentLabel}
          kpiStatus={hm.statuses.recruitment}
        />
        <Figure
          label="Active HP"
          value={hm.activeHpLabel}
          href={hm.activeHpHref}
          hrefLabel={`Active HP for ${hm.name} - open the HP list`}
          kpiStatus={hm.statuses.activeHp}
        />
      </dl>

      <div className="mt-5 border-t hairline-inner pt-3.5">
        <TargetProgress target={targetOf(hm)} subject={hm.name} size="sm" />
      </div>

      {!hm.hasMonthlyRecord ? (
        <p className="mt-3 text-[11px] text-amber-700">
          No monthly figures entered yet
        </p>
      ) : null}
    </article>
  );
}

/** The card's target section, in the shape `TargetProgress` reads. */
function targetOf(hm: HmCardModel) {
  return {
    netLabel: hm.netLabel,
    targetLabel: hm.targetLabel,
    achievementLabel: hm.achievementLabel,
    progressPct: hm.progressPct,
    hasTarget: hm.hasTarget,
  };
}

type FigureProps = {
  label: string;
  value: string;
  emphasis?: boolean;
  /**
   * Makes the figure itself a link.
   *
   * `relative z-10` is what makes it work at all: the card's stretched overlay
   * covers everything, so a link that did not lift above it would be dead.
   */
  href?: string | null;
  hrefLabel?: string;
  /** The Stage 9 band, rendered as a dot AND a word, never as colour alone. */
  kpiStatus?: KpiStatusModel;
  /** Whether to print what the band was measured against under it. */
  showNote?: boolean;
};

function Figure({
  label,
  value,
  emphasis,
  href,
  hrefLabel,
  kpiStatus,
  showNote = false,
}: FigureProps) {
  return (
    <div className="min-w-0">
      <dt className="section-label truncate">{label}</dt>
      <dd
        className={cn(
          "figure-num mt-1 font-semibold text-slate-900",
          emphasis ? "text-2xl leading-none" : "text-lg leading-none",
        )}
      >
        {href ? (
          <Link
            href={href}
            aria-label={hrefLabel ?? `${label}, ${value}`}
            className="relative z-10 rounded underline decoration-sky-300 decoration-2 underline-offset-4 hover:text-sky-800 hover:decoration-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>

      {/* Under the figure rather than beside it. At 375px a card column is
          about 150px wide, and a band on the same line as a 24px number would
          push one of the two off the card. */}
      {kpiStatus ? (
        <KpiStatusBadge
          status={kpiStatus}
          showNote={showNote}
          className="mt-1.5"
        />
      ) : null}
    </div>
  );
}
