import Link from "next/link";

import { TargetProgress } from "@/components/dashboard/target-progress";
import { HmAvatar } from "@/components/hm/hm-avatar";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
} from "@/components/ui/status-styles";
import { cn } from "@/lib/utils";
import type { HmCardModel } from "@/lib/view-models/dashboard";

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
 * looked at. There is exactly ONE link in it - on the name - stretched over the
 * card by a positioned pseudo-element, rather than a wrapper `<a>` around the
 * figures. That keeps the accessible name short and meaningful ("Alisha,
 * Amcorp Mall") instead of a screen reader announcing a link made of eight
 * numbers, and it leaves the text inside selectable.
 *
 * Fixed structure keeps a grid of them aligned: every card has the same rows,
 * whether or not the figures behind them have been entered.
 */
export function HmCard({ hm }: HmCardProps) {
  return (
    <article
      aria-label={`${hm.name}, ${hm.office}`}
      className="group relative flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50/30 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-200"
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
            <h3 className="text-sm font-semibold break-words text-slate-900">
              {/* `after:absolute inset-0` turns the card into the hit area
                  without nesting the figures inside the anchor. `relative z-10`
                  on the rank badge is not needed - nothing else in the card is
                  interactive, so there is no click for the overlay to steal. */}
              <Link
                href={hm.href}
                className="outline-none after:absolute after:inset-0 after:rounded-lg group-hover:text-sky-900"
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
          <p className="text-xs break-words text-slate-500">{hm.office}</p>
        </div>

        <span
          className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600"
          title="Rank by net units"
        >
          #{hm.rank}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label="Net" value={hm.netLabel} emphasis />
        <Figure label="Key-In" value={hm.keyInLabel} />

        <Figure
          label="Recruitment"
          value={hm.recruitmentLabel}
          status={hm.recruitmentStatus}
        />
        <Figure label="Active HP" value={hm.activeHpLabel} />
      </dl>

      <div className="mt-4 border-t border-slate-100 pt-3">
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
  /** Rendered as a dot AND a word, never as colour alone. */
  status?: keyof typeof STATUS_DOT_CLASSES;
};

function Figure({ label, value, emphasis, status }: FigureProps) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 flex items-center gap-1.5 font-semibold tabular-nums text-slate-900",
          emphasis ? "text-2xl leading-none" : "text-lg leading-none",
        )}
      >
        {value}
        {status && status !== "neutral" ? (
          <>
            <span
              aria-hidden
              className={cn("size-2 rounded-full", STATUS_DOT_CLASSES[status])}
            />
            <span className="sr-only">{STATUS_LABELS[status]}</span>
          </>
        ) : null}
      </dd>
    </div>
  );
}
