import Link from "next/link";

import { HmAvatar } from "@/components/hm/hm-avatar";
import { Badge } from "@/components/ui/badge";
import { KpiStatusBadge } from "@/components/ui/kpi-status";
import { cn } from "@/lib/utils";
import type { KpiStatusModel } from "@/lib/view-models/dashboard";
import type { PublicHmCard } from "@/lib/view-models/public-share";

type ShareHmCardProps = {
  hm: PublicHmCard;
  /**
   * That HM's read-only view, under the same token, or `null` for a card that
   * opens nothing.
   *
   * Always supplied by the report today. It stays optional because "the card is
   * a link" and "the link is inside the token" are two separate decisions, and
   * a future surface that has no token to build one from should render a card
   * that is honestly inert rather than one pointing nowhere.
   */
  href?: string | null;
};

/**
 * One HM, on the shared report.
 *
 * Related to the dashboard card and deliberately not the same component. Two
 * differences carry the distinction between the private app and a link in a
 * group chat:
 *
 *   Where it goes. The dashboard card opens `/hm/<id>`, inside the application;
 *   this one opens `/share/<token>/hm/<id>`, which is the same figures with no
 *   session, no navigation and no way out of the token. It never links into the
 *   private app, and it carries no `?month=` - the token decides the month.
 *
 *   The target track is gone. Per-HM targets are a management conversation, not
 *   something to post to the group - so the shared card carries the four
 *   figures the WhatsApp message carries and stops there.
 *
 * The hit area is the whole card, expressed the same way the dashboard's is:
 * ONE link, on the name, stretched over the card by a positioned
 * pseudo-element. A wrapper `<a>` around the figures would have a screen reader
 * announce a link made of eight numbers, and would stop the text being
 * selectable - on a report people quote into a chat.
 *
 * Sized for a phone first: two columns of figures at 375px, four across once
 * there is room, and the name wraps rather than truncating.
 */
export function ShareHmCard({ hm, href = null }: ShareHmCardProps) {
  return (
    <article
      aria-label={`${hm.name}, ${hm.office}`}
      className={cn(
        "glass-card p-3.5 sm:p-4",
        href
          ? "group relative transition-colors hover:border-sky-300 hover:bg-sky-50/30 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-200"
          : null,
      )}
    >
      <header className="flex items-start gap-3">
        <HmAvatar name={hm.name} photoUrl={hm.photoUrl} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[0.9375rem] font-semibold leading-snug tracking-tight break-words text-slate-900">
              {href ? (
                <Link
                  href={href}
                  className="outline-none after:absolute after:inset-0 after:rounded-card group-hover:text-sky-900"
                >
                  {hm.name}
                  <span className="sr-only"> - open full performance</span>
                </Link>
              ) : (
                hm.name
              )}
            </h3>
            {!hm.isActive ? <Badge tone="muted">Inactive</Badge> : null}
          </div>
          <p className="text-xs break-words text-slate-500">{hm.office}</p>
        </div>

        <span
          className="shrink-0 rounded-full bg-slate-900/[0.05] px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 ring-1 ring-inset ring-slate-900/[0.06]"
          title="Rank by net units"
        >
          #{hm.rank}
        </span>

        {/* The one visual addition a clickable card needs. Hover and a focus
            ring say "this opens" on a desktop; on the phone in a WhatsApp group
            - which is where this page is actually read - neither exists, and
            without a chevron the card is a link nobody knows is there.
            `aria-hidden` because the link already says where it goes. */}
        {href ? (
          <span
            aria-hidden
            className="shrink-0 self-center text-base leading-none text-slate-300 group-hover:text-sky-600"
          >
            ›
          </span>
        ) : null}
      </header>

      {/* The four figures, each with its pacing band underneath. This is what
          the link is for: an HM reading it on their phone should be able to see
          which of their four numbers needs work without asking anybody. */}
      <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4">
        <Figure
          label="Net"
          value={hm.netLabel}
          emphasis
          kpiStatus={hm.statuses.net}
          showNote
        />
        {/* The figure is the month's Key-In so far; the band under it is the
            running total through the current week against the monthly target,
            and its note says which. */}
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
          kpiStatus={hm.statuses.activeHp}
        />
      </dl>

      {!hm.hasMonthlyRecord ? (
        <p className="mt-3 text-[11px] text-amber-700">
          No monthly figures entered yet
        </p>
      ) : null}
    </article>
  );
}

type FigureProps = {
  label: string;
  value: string;
  emphasis?: boolean;
  /**
   * The Stage 9 band: a dot AND a word, never colour alone.
   *
   * It replaces the older Stage 2 recruitment dot on this card rather than
   * joining it. The two use different thresholds - 3 recruits is GREEN under
   * the old band and Watch under the new - and two verdicts on one figure is
   * worse than either. `recruitmentStatus` stays on the MODEL, because the
   * WhatsApp message still reads it.
   */
  kpiStatus?: KpiStatusModel;
  /** Whether to print what the band was measured against under it. */
  showNote?: boolean;
};

function Figure({
  label,
  value,
  emphasis,
  kpiStatus,
  showNote = false,
}: FigureProps) {
  return (
    <div className="min-w-0">
      <dt className="section-label truncate">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 font-semibold tabular-nums text-slate-900",
          emphasis ? "text-xl leading-none" : "text-lg leading-none",
        )}
      >
        {value}
      </dd>

      {/* Under the figure, not beside it: at 375px this card gives a column
          about 150px, and a band on the same line as the number would push one
          of the two off the card. */}
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
