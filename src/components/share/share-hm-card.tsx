import Link from "next/link";

import { HmAvatar } from "@/components/hm/hm-avatar";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
} from "@/components/ui/status-styles";
import { cn } from "@/lib/utils";
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
        "rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4",
        href
          ? "group relative transition-colors hover:border-sky-300 hover:bg-sky-50/30 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-200"
          : null,
      )}
    >
      <header className="flex items-start gap-3">
        <HmAvatar name={hm.name} photoUrl={hm.photoUrl} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold break-words text-slate-900">
              {href ? (
                <Link
                  href={href}
                  className="outline-none after:absolute after:inset-0 after:rounded-lg group-hover:text-sky-900"
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
          className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600"
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

      <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure label="Net" value={hm.netLabel} emphasis />
        <Figure label="Key-In" value={hm.keyInLabel} />
        <Figure
          label="Recruitment"
          value={hm.recruitmentLabel}
          status={hm.recruitmentStatus}
        />
        <Figure label="Active HP" value={hm.activeHpLabel} />
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
  /** A dot AND a word. Never colour alone. */
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
          emphasis ? "text-xl leading-none" : "text-lg leading-none",
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
